import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app as electronApp, ipcMain } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import writeAtomic from 'write-file-atomic'
import log from 'electron-log'
import { isPreviewTarget, isThemeSample, maxThemeSampleLength, type PreviewTarget } from '@shared/localTheme'
import { maxThemeCss, themeCssIssue } from '@shared/themeCss'
import type { ThemeCollaborationConnection, ThemeCollaborationFiles, ThemeCollaborationIssue, ThemeCollaborationState } from '@shared/themeCollaboration'
import type Accessor from '../app/accessor'
import { WindowType } from '../windows/base'
import { requireModelWindow } from './windowAuth'
import { previewCaptureTool } from './themePreviewCapture'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const requestFilename = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.json$/i
const skillName = 'autumnmark-theme'
const jpegPrefix = 'data:image/jpeg;base64,'

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await requireDirectory(path)
}

async function requireDirectory(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) throw new Error('invalidCollaborationPath')
}

async function readText(path: string, maxBytes: number): Promise<string> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('invalidCollaborationFile')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const bytes = Buffer.allocUnsafe(maxBytes + 1)
    const { bytesRead } = await handle.read(bytes)
    const actual = await handle.stat()
    if (!actual.isFile() || bytesRead > maxBytes || actual.size !== bytesRead) throw new Error('invalidCollaborationFile')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))
  } finally { await handle.close() }
}

async function seed(path: string, value: string): Promise<void> {
  try { await writeFile(path, value, { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function validateFiles(value: unknown): asserts value is ThemeCollaborationFiles {
  const files = value as Partial<ThemeCollaborationFiles> | null
  if (typeof files?.css !== 'string' || themeCssIssue(files.css) || !isThemeSample(files.sampleMarkdown)) {
    throw new Error('invalidRequest')
  }
}

async function installSkill(): Promise<'installed' | 'conflict'> {
  const source = await readFile(join(__static, 'skills', skillName, 'SKILL.md'), 'utf8')
  const folder = join(electronApp.getPath('home'), '.agents', 'skills', skillName)
  await ensureDirectory(folder)
  const destination = join(folder, 'SKILL.md')
  await seed(destination, source)
  return await readText(destination, 64 * 1024) === source.replace(/^\uFEFF/, '') ? 'installed' : 'conflict'
}

type Capture = (target: PreviewTarget, files: ThemeCollaborationFiles, signal: AbortSignal) => Promise<{ text: string; image?: string }>

function createWorkspace(directory: string, initial: ThemeCollaborationFiles,
  publish: (id: string, state: ThemeCollaborationState) => void, capture: Capture) {
  const id = randomUUID()
  const controller = new AbortController()
  const { signal } = controller
  const cssPath = join(directory, 'theme.css')
  const samplePath = join(directory, 'sample.md')
  const basePath = join(directory, 'base.css')
  const requests = join(directory, 'requests')
  const previews = join(directory, 'previews')
  let state: ThemeCollaborationState = { ...initial, revision: 0 }
  let baseCss = ''
  let watcher: FSWatcher | undefined
  let pending = Promise.resolve()
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const screenshotRequests = new Set<string>()
  let capturing = false

  function serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = pending.then(action)
    pending = next.then(() => {}, () => {})
    return next
  }

  function update(files: ThemeCollaborationFiles, issue?: ThemeCollaborationIssue, notify = true): void {
    if (state.css === files.css && state.sampleMarkdown === files.sampleMarkdown &&
      JSON.stringify(state.issue) === JSON.stringify(issue)) return
    state = { css: files.css, sampleMarkdown: files.sampleMarkdown, issue, revision: state.revision + 1 }
    if (notify && !signal.aborted) publish(id, state)
  }

  async function refresh(notify = true): Promise<ThemeCollaborationState> {
    signal.throwIfAborted()
    try {
      await requireDirectory(directory)
      const css = await readText(cssPath, maxThemeCss * 4)
      const detail = themeCssIssue(css)
      if (detail) update(state, { kind: 'css', detail }, notify)
      else {
        const sampleMarkdown = await readText(samplePath, maxThemeSampleLength * 4)
        if (isThemeSample(sampleMarkdown)) update({ css, sampleMarkdown }, undefined, notify)
        else update(state, { kind: 'sample' }, notify)
      }
    } catch {
      update(state, { kind: 'files' }, notify)
    }
    return state
  }

  async function screenshot(path: string, requestId: string): Promise<void> {
    if (signal.aborted || screenshotRequests.has(requestId)) return
    screenshotRequests.add(requestId)
    const receipt = join(previews, requestId + '.json')
    let ownsCapture = false
    let canWriteReceipt = false
    try {
      await requireDirectory(directory)
      await requireDirectory(previews)
      canWriteReceipt = true
      try {
        await lstat(receipt)
        return
      } catch (error) {
        if (!missing(error)) throw error
      }
      await requireDirectory(requests)
      const target: unknown = JSON.parse(await readText(path, 4096))
      if (!isPreviewTarget(target)) throw new Error('Use framing, selector, occurrence and slice as described in the Skill.')
      const snapshot = await serialize(refresh)
      if (snapshot.issue) throw new Error('Fix the collaboration files before requesting a screenshot.')
      signal.throwIfAborted()
      if (capturing) throw new Error('A screenshot is already in progress. Use a new request ID after it finishes.')
      capturing = true
      ownsCapture = true
      const result = await capture({ ...target, selector: target.selector.trim() }, snapshot, signal)
      signal.throwIfAborted()
      if (!result.image?.startsWith(jpegPrefix)) throw new Error(result.text)
      const filename = requestId + '.jpg'
      await requireDirectory(directory)
      await requireDirectory(previews)
      await writeAtomic(join(previews, filename), Buffer.from(result.image.slice(jpegPrefix.length), 'base64'))
      await writeAtomic(receipt, JSON.stringify({ status: 'ok', image: 'previews/' + filename, message: result.text }) + '\n')
    } catch (error) {
      if (!signal.aborted && canWriteReceipt) {
        await requireDirectory(directory)
        await requireDirectory(previews)
        const message = error instanceof Error ? error.message : 'The preview could not be captured.'
        await writeAtomic(receipt, JSON.stringify({ status: 'error', message }) + '\n')
      }
    } finally {
      if (ownsCapture) capturing = false
      screenshotRequests.delete(requestId)
    }
  }

  function changed(event: string, path: string): void {
    if (path === cssPath || path === samplePath) {
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void serialize(refresh).catch(() => {}), 40)
      return
    }
    const request = requestFilename.exec(basename(path))
    if (request && dirname(path) === requests && (event === 'add' || event === 'change')) {
      void screenshot(path, request[1]).catch(error => log.warn('Could not write the theme preview result', error))
    }
  }

  async function start(reference: string): Promise<ThemeCollaborationConnection> {
    await ensureDirectory(directory)
    await Promise.all([ensureDirectory(requests), ensureDirectory(previews), seed(cssPath, initial.css), seed(samplePath, initial.sampleMarkdown)])
    await writeAtomic(basePath, reference)
    baseCss = reference
    signal.throwIfAborted()
    watcher = chokidar.watch([cssPath, samplePath, requests], {
      ignoreInitial: true, followSymlinks: false, depth: 0, atomic: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    }).on('all', changed)
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      watcher?.once('ready', () => {
        signal.removeEventListener('abort', abort)
        resolve()
      })
      watcher?.on('error', error => {
        reject(error)
        update(state, { kind: 'files' })
      })
    })
    return { id, directory, state: await serialize(() => refresh(false)) }
  }

  function write(revision: number, files: ThemeCollaborationFiles, reference: string) {
    return serialize(async() => {
      const latest = await refresh()
      if (latest.issue || latest.revision !== revision) return { saved: false, state: latest }
      signal.throwIfAborted()
      try {
        await requireDirectory(directory)
        if (reference !== baseCss) {
          await writeAtomic(basePath, reference)
          baseCss = reference
        }
        if (files.css !== latest.css) await writeAtomic(cssPath, files.css)
        if (files.sampleMarkdown !== latest.sampleMarkdown) await writeAtomic(samplePath, files.sampleMarkdown)
      } catch (error) {
        await refresh()
        throw error
      }
      update(files, undefined, false)
      return { saved: true, state }
    })
  }

  function close(): void {
    controller.abort()
    clearTimeout(refreshTimer)
    void watcher?.close().catch(error => log.warn('Could not close the theme collaboration watcher', error))
  }

  return { id, directory, start, write, close }
}

export function registerThemeCollaboration(app: Accessor): void {
  const sessions = new Map<number, { workspace: ReturnType<typeof createWorkspace>; close: () => void }>()
  const root = join(app.paths.userDataPath, 'theme-collaboration')
  ipcMain.handle('mt::theme::collaboration-install', event => {
    requireModelWindow(app, event, WindowType.STUDIO)
    return installSkill()
  })
  ipcMain.handle('mt::theme::collaboration-start', async(event, draftId: string, files: ThemeCollaborationFiles, baseCss: string) => {
    requireModelWindow(app, event, WindowType.STUDIO)
    const { sender } = event
    if (typeof draftId !== 'string' || !uuid.test(draftId) || typeof baseCss !== 'string' || baseCss.length > 100_000 ||
      sessions.has(sender.id)) throw new Error('invalidRequest')
    validateFiles(files)
    const senderId = sender.id
    await ensureDirectory(root)
    const directory = join(root, draftId.toLowerCase())
    if (sender.isDestroyed() || sessions.has(senderId) || [...sessions.values()].some(({ workspace }) => workspace.directory === directory)) {
      throw new Error('invalidRequest')
    }
    const workspace = createWorkspace(directory, files, (id, state) => {
      if (!sender.isDestroyed()) sender.send('mt::theme::collaboration-state', id, state)
    }, (target, snapshot, signal) => previewCaptureTool(sender, signal, event => {
      if (!sender.isDestroyed()) sender.send('mt::theme::collaboration-capture', workspace.id, { ...event, sampleMarkdown: snapshot.sampleMarkdown })
    })(target, snapshot.css))
    const close = (): void => {
      workspace.close()
      if (sessions.get(senderId)?.workspace === workspace) sessions.delete(senderId)
      sender.removeListener('destroyed', close)
      sender.removeListener('did-navigate', close)
      sender.removeListener('render-process-gone', close)
    }
    sessions.set(senderId, { workspace, close })
    sender.once('destroyed', close)
    sender.once('did-navigate', close)
    sender.once('render-process-gone', close)
    try { return await workspace.start(baseCss) }
    catch (error) {
      close()
      throw error
    }
  })
  ipcMain.handle('mt::theme::collaboration-write', (event, id: string, revision: number, files: ThemeCollaborationFiles, baseCss: string) => {
    requireModelWindow(app, event, WindowType.STUDIO)
    const session = sessions.get(event.sender.id)
    if (!session || id !== session.workspace.id || !Number.isSafeInteger(revision) || revision < 0 ||
      typeof baseCss !== 'string' || baseCss.length > 100_000) throw new Error('invalidRequest')
    validateFiles(files)
    return session.workspace.write(revision, files, baseCss)
  })
  ipcMain.handle('mt::theme::collaboration-stop', (event, id: string) => {
    requireModelWindow(app, event, WindowType.STUDIO)
    const session = sessions.get(event.sender.id)
    if (session && id === session.workspace.id) session.close()
  })
}
