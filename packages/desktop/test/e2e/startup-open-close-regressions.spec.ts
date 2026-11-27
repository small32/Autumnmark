import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import type { ApplicationState } from '../../src/shared/types/applicationState'
import { enterSourceMode, launchElectron, openProjectFolder, sendIpcToRenderer } from './helpers'

let directory: string
let profile: string
const running = new Set<ElectronApplication>()
test.beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mt-startup-open-close-'))
  profile = join(directory, 'profile')
})
test.afterEach(async() => {
  for (const app of running) await app.close()
  running.clear()
  rmSync(directory, { recursive: true, force: true })
})
const state = (): ApplicationState =>
  JSON.parse(readFileSync(join(profile, 'state', 'application-state.json'), 'utf8'))
const launch = async(args: string[], preferences: Record<string, unknown> = {}) => {
  const launched = await launchElectron(args, {
    userDataDir: profile,
    preferences: { language: 'en', autoSave: false, openFilesInNewWindow: false, ...preferences },
    suppressErrorDialog: true
  })
  running.add(launched.app)
  return launched
}

test('closing the last window and launching the app restores its open folder and active tab', async() => {
  const folder = join(directory, 'workspace')
  mkdirSync(folder)
  const pathname = join(folder, 'notes.md')
  writeFileSync(pathname, '# Meeting notes\n')
  const first = await launch([pathname])
  await openProjectFolder(first.app, first.page, folder, pathname)
  await sendIpcToRenderer(first.app, 'mt::set-view-layout', { showTabBar: true })
  await expect(first.page.locator('.editor-tabs')).toBeVisible()
  await first.page.getByRole('textbox', { name: 'Document', exact: true }).fill('Discard these edits')
  await first.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async() => ({ response: 1, checkboxChecked: false })
  })
  const closed = first.page.waitForEvent('close')
  const quit = process.platform === 'darwin' ? null : first.app.waitForEvent('close')
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  let page
  if (quit) {
    await quit
    running.delete(first.app)
    page = (await launch([])).page
  } else {
    const reopened = first.app.waitForEvent('window')
    await first.app.evaluate(({ app }) => app.emit('activate'))
    page = await reopened
  }
  await expect(page.locator('.project-root')).toContainText('workspace')
  await expect(page.locator('.tabs-container > li.active')).toHaveAttribute('title', pathname)
  await expect(page.getByRole('textbox', { name: 'Document', exact: true })).toContainText('Meeting notes')
  expect(readFileSync(pathname, 'utf8')).toBe('# Meeting notes\n')
})

test('opening a file after a hard kill recovers the workspace and continuous edits', async() => {
  const folder = join(directory, 'workspace')
  mkdirSync(folder)
  const firstPath = join(folder, 'first.md')
  const draftPath = join(folder, 'draft.md')
  writeFileSync(firstPath, 'First file\n')
  writeFileSync(draftPath, 'Saved draft\n')
  const first = await launch([folder, firstPath, draftPath])
  await sendIpcToRenderer(first.app, 'mt::set-view-layout', { showSideBar: true, showTabBar: true })
  await enterSourceMode(first.page, first.app)
  const before = state().session.windows[0]
  await first.page.locator('.source-code .CodeMirror').evaluate(element => {
    const editor = (element as HTMLElement & { CodeMirror: { setValue(value: string): void } }).CodeMirror
    let count = 0
    window.setInterval(() => editor.setValue(`Unsaved version ${++count}`), 50)
  })
  await expect.poll(() => state().session.windows[0].documents.find(doc => doc.id === before.activeDocumentId)?.content.kind).toBe('recovery')
  const pid = await first.app.evaluate(() => process.pid)
  const closed = first.app.waitForEvent('close')
  process.kill(pid, 'SIGKILL')
  await closed
  running.delete(first.app)

  const restored = await launch([draftPath])
  await expect(restored.page.locator('.project-root')).toContainText('workspace')
  await expect(restored.page.locator('.source-code .CodeMirror-code')).toContainText('Unsaved version')
  await expect(restored.page.locator('.tabs-container > li.active')).toHaveAttribute('title', draftPath)
  const after = state().session.windows[0]
  expect(after.id).toBe(before.id)
  expect(after.documents.map(doc => doc.id)).toEqual(before.documents.map(doc => doc.id))
  expect(readFileSync(draftPath, 'utf8')).toBe('Saved draft\n')
})

test('Save As writes the exact extensionless dialog path without overwriting its md sibling', async() => {
  const original = join(directory, 'original.md')
  const destination = join(directory, 'notes')
  const sibling = `${destination}.md`
  writeFileSync(original, 'Original editor text')
  writeFileSync(sibling, 'Unrelated file must survive')
  const { app, page } = await launch([original])
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async() => ({ canceled: false, filePath })
  }, destination)
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save-as')
  await expect.poll(() => state().session.windows[0].documents[0].title).not.toBe('original.md')
  expect(readFileSync(sibling, 'utf8')).toBe('Unrelated file must survive')
  expect(existsSync(destination)).toBe(true)
  expect(readFileSync(destination, 'utf8').trim()).toBe('Original editor text')
  await page
    .getByRole('textbox', { name: 'Document', exact: true })
    .fill('Saved again without extension')
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
  await expect
    .poll(() => readFileSync(destination, 'utf8').trim())
    .toBe('Saved again without extension')
  expect(readFileSync(sibling, 'utf8')).toBe('Unrelated file must survive')
  await app.close()
  running.delete(app)
  const restored = await launch([])
  await expect(restored.page.getByRole('textbox', { name: 'Document', exact: true })).toContainText(
    'Saved again without extension'
  )
  writeFileSync(destination, 'External edit without extension')
  await expect(restored.page.getByRole('textbox', { name: 'Document', exact: true })).toContainText(
    'External edit without extension'
  )
})

test('Save As cannot replace a file already open in another tab', async() => {
  const source = join(directory, 'first.md')
  const destination = join(directory, 'second.md')
  writeFileSync(source, 'Original first document')
  writeFileSync(destination, 'Original second document')
  const { app, page } = await launch([source, destination])
  await expect(page.getByRole('textbox', { name: 'Document', exact: true })).toContainText(
    'Original first document'
  )
  await app.evaluate(({ dialog }, pathname) => {
    dialog.showSaveDialog = async() => ({ canceled: false, filePath: pathname })
  }, destination)
  await sendIpcToRenderer(app, 'mt::editor-ask-file-save-as')
  await expect(page.getByText('A document is already open at the destination path.', { exact: false }).first())
    .toBeVisible()
  expect(readFileSync(destination, 'utf8')).toBe('Original second document')
  expect(state().session.windows[0].documents.map(document => document.title)).toEqual(['first.md', 'second.md'])
})

test('rename is blocked when the document is also open in another window', async() => {
  const source = join(directory, 'original.md')
  const destination = join(directory, 'renamed.md')
  writeFileSync(source, 'Shared document')
  const { app, page } = await launch([source])
  const opened = app.waitForEvent('window')
  await app.evaluate(({ app }, pathname) => {
    const argv = ['marktext', '--new-window', pathname]
    app.emit('second-instance', {}, argv, '/', { argv })
  }, source)
  const secondWindow = await opened
  await expect(secondWindow.getByRole('textbox', { name: 'Document', exact: true })).toContainText('Shared document')
  const id = state().session.windows[0].documents[0].id
  await page.evaluate(({ id, source, destination }) => {
    window.electron.ipcRenderer.send('mt::rename', { id, pathname: source, newPathname: destination })
  }, { id, source, destination })
  await expect(page.getByText('Close this file and any documents inside this folder', { exact: false }))
    .toBeVisible()
  expect(readFileSync(source, 'utf8')).toBe('Shared document')
  expect(existsSync(destination)).toBe(false)
})

for (const newWindows of [false, true]) {
  test(`explicit read-only overrides workspace restoration (new windows=${newWindows})`, async() => {
    const folder = join(directory, 'workspace')
    mkdirSync(folder)
    const pathname = join(folder, 'note.md')
    writeFileSync(pathname, 'Workspace file')
    const first = await launch([folder, pathname])
    await expect.poll(() => state().recentWorkspaces[0]?.files.length).toBe(1)
    await first.app.close()
    running.delete(first.app)
    const restored = await launch(['--read-only', folder, pathname], {
      openFilesInNewWindow: newWindows
    })
    await expect(restored.page.locator('.mu-read-only')).toBeVisible()
    await expect
      .poll(() =>
        state()
          .session.windows.flatMap((window) => window.documents)
          .map((document) => document.readOnly)
      )
      .toEqual(newWindows ? [true, true] : [true])
    expect(readFileSync(pathname, 'utf8')).toBe('Workspace file')
  })
}

for (const newWindows of [true, false]) {
  test(`cold CLI startup honors openFilesInNewWindow=${newWindows}`, async() => {
    const first = join(directory, 'one.md')
    const second = join(directory, 'two.md')
    writeFileSync(first, 'First CLI file')
    writeFileSync(second, 'Second CLI file')
    const { app } = await launch([first, second], { openFilesInNewWindow: newWindows })
    await expect.poll(() => state().session.windows.length).toBe(newWindows ? 2 : 1)
    const windows = state().session.windows
    expect(windows.map((window) => window.documents.length)).toEqual(newWindows ? [1, 1] : [2])
    expect(
      windows.flatMap((window) => window.documents.map((document) => document.title)).sort()
    ).toEqual(['one.md', 'two.md'])
    await expect.poll(() => app.windows().length).toBe(newWindows ? 2 : 1)
  })
}

test('cold explicit new-window keeps multiple files grouped despite the preference', async() => {
  const first = join(directory, 'one.md')
  const second = join(directory, 'two.md')
  writeFileSync(first, 'First CLI file')
  writeFileSync(second, 'Second CLI file')
  await launch(['--new-window', first, second], { openFilesInNewWindow: true })
  await expect
    .poll(() => state().session.windows.map((window) => window.documents.length))
    .toEqual([2])
})

for (const initialDirty of [false, true]) {
  test(`persisted edits after a final checkpoint cancel quit (discard=${initialDirty})`, async() => {
    const firstPath = join(directory, 'one.md')
    const secondPath = join(directory, 'two.md')
    writeFileSync(firstPath, 'First clean file')
    writeFileSync(secondPath, 'Second clean file')
    const { app, page } = await launch([firstPath], { startUpAction: 'blank' })
    const opened = app.waitForEvent('window')
    await app.evaluate(({ app }, pathname) => {
      const argv = ['marktext', '--new-window', pathname]
      app.emit('second-instance', {}, argv, '/', { argv })
    }, secondPath)
    const second = await opened
    await expect(second.getByRole('textbox', { name: 'Document', exact: true })).toContainText(
      'Second clean file'
    )
    await expect.poll(() => state().session.windows.length).toBe(2)
    if (initialDirty) {
      await page
        .getByRole('textbox', { name: 'Document', exact: true })
        .fill('Earlier consented draft')
      await expect.poll(() => state().session.windows[0].documents[0].content.kind).toBe('recovery')
    }
    const secondNativeId = await (await app.browserWindow(second)).evaluate((window) => window.id)
    await app.evaluate(
      ({ app, BrowserWindow, dialog }, { secondNativeId, initialDirty }) => {
        const audit = globalThis as unknown as {
          held: boolean
          release: () => void
          prompts: number
        }
        audit.held = false
        audit.prompts = 0
        dialog.showMessageBox = async() => {
          audit.prompts++
          return { response: initialDirty && audit.prompts === 1 ? 1 : 2, checkboxChecked: false }
        }
        const native = BrowserWindow.fromId(secondNativeId)
        if (!native) throw new Error('Missing second editor window')
        const send = native.webContents.send.bind(native.webContents)
        let checkpoints = 0
        native.webContents.send = (channel, ...args) => {
          if (channel === 'mt::state::prepare-close') {
            checkpoints++
            if (checkpoints === 2) {
              audit.held = true
              audit.release = () => send(channel, ...args)
              return
            }
          }
          send(channel, ...args)
        }
        app.quit()
      },
      { secondNativeId, initialDirty }
    )
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { held: boolean }).held))
      .toBe(true)
    const before = state().session.windows[0]
    const firstWindowId = before.id
    const content = before.documents[0].content
    const previousRevision = content.kind === 'recovery' ? content.contentRevision : 0
    await page
      .getByRole('textbox', { name: 'Document', exact: true })
      .fill('New edit after final checkpoint')
    await expect
      .poll(() => {
        const latest = state().session.windows.find((window) => window.id === firstWindowId)
          ?.documents[0].content
        return latest?.kind === 'recovery' && latest.contentRevision > previousRevision
      })
      .toBe(true)
    await app.evaluate(() => (globalThis as unknown as { release: () => void }).release())
    await expect
      .poll(async() =>
        app.evaluate(
          ({ app }, expected) => {
            const audit = globalThis as unknown as { prompts: number }
            if (audit.prompts < expected) app.quit()
            return audit.prompts
          },
          initialDirty ? 2 : 1
        )
      )
      .toBe(initialDirty ? 2 : 1)
    expect(app.windows()).toHaveLength(2)
    expect(state().session.lifecycle).toBe('running')
    expect(
      state().session.windows.find((window) => window.id === firstWindowId)?.documents[0].content
        .kind
    ).toBe('recovery')
    expect(readFileSync(firstPath, 'utf8')).toBe('First clean file')
    await expect(page.getByRole('textbox', { name: 'Document', exact: true })).toContainText(
      'New edit after final checkpoint'
    )
  })
}
