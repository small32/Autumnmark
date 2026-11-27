import fs from 'fs-extra'
import { constants, type Stats } from 'fs'
import path from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import {
  isFile as commonIsFile,
  isDirectory as commonIsDirectory,
  isExecutableFile
} from 'common/filesystem'
import { hasMarkdownExtension, isChildOfDirectory } from 'common/filesystem/paths'
import type { SerializedStat } from '@shared/types/files'
import type { SidebarMoveRequest, SidebarMoveResult } from '@shared/types/project'
import { copyFileWithContentHash } from '../filesystem'
import { loadMarkdownFile, readMarkdownSource, writeMarkdownFile } from '../filesystem/markdown'
import { applyMarkdownEdits, type MarkdownEdit } from '@shared/markdownEdits'
import { listMediaDocuments, mediaFileKey } from '../filesystem/mediaDocuments'

const serializeStat = (stats: Stats): SerializedStat => ({
  size: stats.size,
  birthtimeMs: stats.birthtimeMs,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  isFile: stats.isFile(),
  isDirectory: stats.isDirectory(),
  isSymbolicLink: stats.isSymbolicLink()
})

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: string }).type === 'Buffer' &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data)
  }
  return data
}

async function copyNewItem(src: string, dest: string): Promise<void> {
  const source = await fs.lstat(src)
  if (source.isDirectory()) {
    const [sourcePath, destinationParent] = await Promise.all([
      fs.realpath(src), fs.realpath(path.dirname(dest))
    ])
    if (!path.relative(sourcePath, destinationParent) || isChildOfDirectory(sourcePath, destinationParent))
      throw new Error('Cannot copy a folder into itself.')

    // Claim the directory exclusively before writing children; a recursive copy can merge it.
    await fs.mkdir(dest)
    for (const name of await fs.readdir(src)) {
      await copyNewItem(path.join(src, name), path.join(dest, name))
    }
    await fs.chmod(dest, source.mode)
  } else if (source.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(src), dest)
  } else if (source.isFile()) {
    await fs.copyFile(src, dest, constants.COPYFILE_EXCL)
  } else {
    throw new Error(`Cannot copy "${src}".`)
  }
}

export interface FileOperations {
  isDocumentOpen(pathname: string): Promise<boolean>
  move(sender: WebContents, src: string, dest: string, write: () => Promise<void>): Promise<void>
  moveInProject(sender: WebContents, request: SidebarMoveRequest): Promise<SidebarMoveResult>
}
export const registerFsHandlers = (operations?: FileOperations): void => {
  const updating = new Set<string>()
  ipcMain.handle('mt::media::list-documents', (_event, target: string, directory: boolean, excludes: string[], openPaths: string[]) =>
    listMediaDocuments(target, directory, excludes, openPaths))
  ipcMain.handle('mt::media::read-document', async(_event, pathname: string, guessEncoding: boolean) => {
    if (!hasMarkdownExtension(pathname)) throw new Error('Expected a Markdown document')
    const target = await fs.realpath(pathname)
    const key = mediaFileKey(await fs.stat(target, { bigint: true }), target)
    const source = await readMarkdownSource(target, guessEncoding, true)
    return { markdown: source.markdown, hash: key + '/' + source.rawBaseline.rawSha256 }
  })
  ipcMain.handle('mt::media::update-document', async(_event, pathname: string, guessEncoding: boolean, hash: string, edits: MarkdownEdit[]) => {
    if (!hasMarkdownExtension(pathname)) throw new Error('Expected a Markdown document')
    const target = await fs.realpath(pathname)
    const key = mediaFileKey(await fs.stat(target, { bigint: true }), target)
    if (updating.has(key)) return 'changed'
    updating.add(key)
    try {
      const opened = await operations?.isDocumentOpen(target)
      if (opened) return 'changed'
      const source = await readMarkdownSource(target, guessEncoding, true)
      if (key + '/' + source.rawBaseline.rawSha256 !== hash) return 'changed'
      const markdown = applyMarkdownEdits(source.markdown, edits)
      await writeMarkdownFile(target, markdown, { encoding: source.encoding, adjustLineEndingOnSave: false, lineEnding: 'lf' })
      return 'saved'
    } finally {
      updating.delete(key)
    }
  })
  ipcMain.handle('mt::read-heading-link-document', async(_event, pathname: string, guessEncoding: boolean) => {
    if (!hasMarkdownExtension(pathname) || !commonIsFile(pathname)) return null
    return (await loadMarkdownFile(pathname, 'lf', guessEncoding)).markdown
  })
  ipcMain.handle('mt::project-move-item', (event, request: SidebarMoveRequest) => {
    if (!operations) throw new Error('Project operations unavailable')
    return operations.moveInProject(event.sender, request)
  })
  ipcMain.handle('mt::fs::is-file', (_e, p: string) => commonIsFile(p))
  ipcMain.handle('mt::fs::is-directory', (_e, p: string) => commonIsDirectory(p))
  ipcMain.handle('mt::fs::empty-dir', (_e, p: string) => fs.emptyDir(p))
  ipcMain.handle('mt::fs::copy', async(_e, src: string, dest: string, overwrite = true) => {
    if (overwrite) {
      await fs.copy(src, dest)
      return
    }
    try {
      await copyNewItem(src, dest)
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException
      if (fsError.code === 'EEXIST')
        throw new Error(`An item already exists at "${fsError.path ?? dest}".`, { cause: error })
      throw error
    }
  })
  ipcMain.handle('mt::fs::copy-with-content-hash', (_e, src: string, outputDir: string) =>
    copyFileWithContentHash(src, outputDir)
  )
  ipcMain.handle('mt::fs::ensure-dir', (_e, p: string) => fs.ensureDir(p))

  ipcMain.handle('mt::fs::output-file', (_e, p: string, data: unknown) =>
    fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  )
  ipcMain.handle('mt::fs::move', (event, src: string, dest: string) => {
    const move = () => fs.move(src, dest, { overwrite: false })
    if (operations) return operations.move(event.sender, src, dest, move)
    return move()
  })
  ipcMain.handle('mt::fs::stat', async(_e, p: string) => serializeStat(await fs.stat(p)))

  ipcMain.handle('mt::fs::write-file', (_e, p: string, data: unknown) =>
    fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  )
  ipcMain.handle('mt::fs::read-file', async(_e, p: string, encoding?: BufferEncoding) => {
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  ipcMain.handle('mt::fs::path-exists', (_e, p: string) => fs.pathExists(p))
  ipcMain.handle('mt::fs::unlink', (_e, p: string) => fs.unlink(p))
  ipcMain.handle('mt::fs::readdir', (_e, p: string) => fs.readdir(p))
  // The same predicate the main process spawns by, or the preferences panel
  // green-ticks a cliScript that then fails with EACCES.
  ipcMain.handle('mt::fs::is-executable', (_e, p: string) => isExecutableFile(p))
}
