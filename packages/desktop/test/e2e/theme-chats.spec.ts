import { once } from 'node:events'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { clickMenuById, launchWithMarkdown } from './helpers'

async function openStudio(app: ElectronApplication) {
  const opened = app.waitForEvent('window')
  await clickMenuById(app, 'createThemeFromCurrent')
  return opened
}

test('the assistant updates the example preview and can revise its Markdown across a reload', async() => {
  const example = '# Theme gallery\n\n> A sample quotation\n\n| Block | Example |\n| --- | --- |\n| Table | Test |'
  const checklist = 'Review preview spacing'
  const requests: { sampleMarkdown: string; css: string }[] = []
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const { messages } = JSON.parse(body)
    const context = JSON.parse(messages[1].content)
    requests.push(context)
    const sampleMarkdown = messages.at(-1).content === 'Add a checklist'
      ? context.sampleMarkdown + '\n\n- [ ] ' + checklist
      : example
    const content = JSON.stringify({ sampleMarkdown }) + '\n' + JSON.stringify({ message: 'Updated the example.' })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
  const profile = { id: 'text', model: 'test', encryptedKey: '', baseUrl, requestType: 'chat-completions',
    reasoningEffort: '', contextSize: null, outputSize: null, inputTypes: [] }
  const { app } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light' },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) } })
  try {
    const studio = await openStudio(app)
    const preview = studio.frameLocator('iframe')
    const log = studio.getByRole('log')
    const send = async(text: string) => {
      await studio.getByLabel('Message the theme assistant').fill(text)
      await studio.getByRole('button', { name: 'Send', exact: true }).click()
    }
    await expect(preview.locator('h1')).toContainText('Ridge notes')
    await send('Generate a richer example document')
    await expect(preview.locator('h1')).toContainText('Theme gallery')
    await expect(preview.locator('table')).toContainText('Example')
    expect(requests[0]).toMatchObject({ sampleMarkdown: expect.stringContaining('# Ridge notes'), css: '' })
    await studio.getByRole('button', { name: 'Markdown source', exact: true }).click()
    await expect(preview.locator('.CodeMirror')).toContainText('A sample quotation')
    await studio.getByRole('button', { name: 'Undo last change' }).click()
    await studio.getByRole('button', { name: 'Document', exact: true }).click()
    await expect(preview.locator('h1')).toContainText('Ridge notes')
    await log.getByRole('button', { name: 'Retry' }).click()
    await expect(preview.locator('h1')).toContainText('Theme gallery')
    await expect(log.getByRole('button', { name: 'Retract' })).toBeEnabled()
    await studio.reload()
    await expect(preview.locator('h1')).toContainText('Theme gallery')
    await send('Add a checklist')
    await expect(preview.locator('main')).toContainText(checklist)
    expect(requests[2]).toMatchObject({ sampleMarkdown: example, css: '' })
    await log.getByRole('button', { name: 'Retract' }).last().click()
    await expect(preview.locator('main')).not.toContainText(checklist)
    await expect(preview.locator('h1')).toContainText('Theme gallery')
    await log.getByRole('button', { name: 'Retract' }).click()
    await expect(preview.locator('h1')).toContainText('Ridge notes')
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})

test('can delete a previous chat and open model settings while a reply is pending', async() => {
  let finishReply = (): void => {}
  const pendingReply = new Promise<void>(resolve => { finishReply = resolve })
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    const prompt = JSON.parse(body).messages.at(-1).content
    if (prompt === 'Current conversation') await pendingReply
    const content = prompt === 'Current conversation' ? 'Current reply finished.' : 'Previous reply finished.'
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
  const profile = { id: 'test', model: 'theme-test', encryptedKey: '', baseUrl, requestType: 'chat-completions',
    reasoningEffort: '', contextSize: null, outputSize: null, inputTypes: [] }
  const { app } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light' },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) } })
  try {
    const studio = await openStudio(app)
    const log = studio.getByRole('log')
    const prompt = studio.getByLabel('Message the theme assistant')
    const picker = studio.getByRole('button', { name: 'Conversation', exact: true })
    const menu = studio.getByRole('dialog', { name: 'Conversation' })
    const previous = menu.getByRole('button', { name: 'Delete chat · Previous conversation' })
    const stop = studio.getByRole('button', { name: 'Stop', exact: true })
    const send = async(text: string) => {
      await prompt.fill(text)
      await studio.getByRole('button', { name: 'Send', exact: true }).click()
    }
    await send('Previous conversation')
    await expect(log).toContainText('Previous reply finished.')
    await studio.getByRole('button', { name: 'New chat' }).click()
    await send('Current conversation')
    await expect(stop).toBeVisible()
    await picker.click()
    await expect(menu.getByRole('button', { name: 'Delete chat · Current conversation' })).toBeDisabled()
    studio.once('dialog', dialog => dialog.accept())
    await previous.click()
    await expect(previous).toHaveCount(0)
    await expect(log).toContainText('Current conversation')
    await picker.click()
    await studio.getByRole('button', { name: 'AI models', exact: true }).click()
    const settingsPage = () => app.windows().find(page => page.url().includes('/settings.html?'))
    await expect.poll(async() => {
      const settings = settingsPage()
      if (!settings) return false
      const win = await app.browserWindow(settings)
      return win.evaluate(window => window.isVisible())
    }).toBe(true)
    const settings = settingsPage()
    if (!settings) throw new Error('Missing settings window')
    await expect(settings.getByRole('row', { name: /theme-test/ })).toBeVisible()
    await expect(stop).toBeVisible()
    finishReply()
    await expect(log).toContainText('Current reply finished.')
    await expect(stop).toHaveCount(0)
    await studio.reload()
    await expect(log).toContainText('Current reply finished.')
    await picker.click()
    await expect(menu.getByRole('button', { name: /^Delete chat/ })).toHaveCount(1)
    await expect(previous).toHaveCount(0)
  } finally {
    finishReply()
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})

test('cancellation retains received feedback and recognizes the same interruption in an older chat', async() => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const delta = { content: '{"message":"The heading is saved."}\n' }
    res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const profile = { id: 'text', model: 'test', requestType: 'chat-completions', encryptedKey: '', inputTypes: [],
    baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port, reasoningEffort: '', contextSize: null, outputSize: null }
  const { app } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light' },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) } })
  try {
    const studio = await openStudio(app)
    const input = studio.getByLabel('Message the theme assistant')
    await input.waitFor()
    const received = studio.evaluate(() => new Promise<string>(resolve => {
      const ipc = window.electron.ipcRenderer
      const off = ipc.on('mt::theme::progress', (_event, id, change) => {
        if ('message' in change) { off(); resolve(id) }
      })
    }))
    await input.fill('Inspect the heading')
    await studio.getByRole('button', { name: 'Send', exact: true }).click()
    const requestId = await received
    const win = await app.browserWindow(studio)
    // A navigation vetoed by will-navigate only produces the start event.
    await win.evaluate(w => { w.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }) })
    const log = studio.getByRole('log')
    await expect(studio.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await studio.evaluate(id => window.electron.ipcRenderer.invoke('mt::theme::cancel', id), requestId)
    await expect(log).toContainText('This turn was interrupted.')
    await expect(log).toContainText('The heading is saved.')
    await expect(log.locator('details')).toHaveCount(0)
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await expect(log.getByRole('button', { name: 'Retry' })).toBeEnabled()
    await studio.evaluate(async() => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('autumnmark.theme-chats')
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('turns', 'readwrite')
          const rows = tx.objectStore('turns')
          const read = rows.getAll()
          read.onsuccess = () => {
            const turn = read.result[0]
            turn.notice = 'The model connection failed or timed out.'
            turn.diagnostics = [{ requestId: turn.id, reason: "Error invoking remote method 'mt::theme::generate': AbortError: This operation was aborted" }]
            rows.put(turn)
          }
          tx.oncomplete = () => resolve()
          tx.onabort = () => reject(tx.error)
        })
      } finally { db.close() }
    })
    await studio.reload()
    await expect(log).toContainText('This turn was interrupted.')
    await expect(log).toContainText('The heading is saved.')
    await expect(log.locator('details')).toHaveCount(0)
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})

test('keeps visual feedback when a hot-reloaded studio receives the legacy CSS return value', async() => {
  const profile = { id: 'vision', baseUrl: 'http://localhost/v1', model: 'vision', requestType: 'chat-completions',
    encryptedKey: '', inputTypes: ['image'] }
  const { app } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light' },
    userDataFiles: { 'theme-model.json': JSON.stringify([{ ...profile, id: 'text', inputTypes: [] }, profile]) } })
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mt::theme::generate-with-tools')
      ipcMain.removeHandler('mt::theme::generate')
      ipcMain.handle('mt::theme::generate', ({ sender }, request) => {
        sender.send('mt::theme::progress', request.id, { message: 'The heading looks like a button.' })
        if (request.messages.at(-1).content === 'Inspect again') {
          return { diagnostic: { requestId: request.id, time: new Date().toISOString(), reason: 'HTTP 503',
            model: 'vision', phase: 'initial', inputCss: request.css, assistantText: '', wireBytes: 0, replyBytes: 0 } }
        }
        return request.css
      })
    })
    const studio = await openStudio(app)
    await studio.getByRole('button', { name: 'CSS source' }).click()
    await studio.getByRole('textbox', { name: 'CSS source' }).focus()
    await studio.keyboard.insertText('h2 { padding: 12px }')
    await studio.getByRole('button', { name: 'AI assistant' }).click()
    const prompt = studio.getByLabel('Message the theme assistant')
    await prompt.fill('Inspect the heading in the screenshot')
    await prompt.press('Enter')
    const first = studio.getByRole('log').locator('.assistant').first()
    await expect(first).toContainText('The heading looks like a button.')
    await expect(first).not.toContainText('padding: 12px')
    await expect(first.locator('details')).toHaveCount(0)
    await expect(studio.getByRole('alert')).toHaveCount(0)
    await prompt.fill('Inspect again')
    await prompt.press('Enter')
    const second = studio.getByRole('log').locator('.assistant').nth(1)
    await expect(second).toContainText('503')
    await studio.getByRole('combobox', { name: 'Model', exact: true }).selectOption('vision')
    await prompt.fill('Inspect the preview using the screenshot tool')
    await prompt.press('Enter')
    await expect(studio.getByRole('log').locator('.assistant').last()).toContainText('Restart Antumnmark+')
    await studio.reload()
    await expect(first).toContainText('The heading looks like a button.')
    await expect(second).toContainText('The heading looks like a button.')
    await expect(second).toContainText('503')
  } finally { await app.close() }
})

test('theme chats survive restarts and support isolated retry, retract, diagnostics and deletion', async() => {
  test.setTimeout(60000)
  const requests: { role: string; content: string }[][] = []
  const invalidEdit = JSON.stringify({ find: 'missing CSS', replace: 'h2 { color: red; }' })
  const css = '.mu-container h2 { margin-top: 59px; }'
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    requests.push(JSON.parse(body).messages)
    const replies = [invalidEdit, JSON.stringify({ find: '', replace: css }) + '\nApplied once.',
      'Independent reply.', 'Replacement reply.', 'Follow-up reply.', 'Edited branch.']
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: replies[requests.length - 1] } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
  const profile = { id: 'test', model: 'theme-test', encryptedKey: '', baseUrl, requestType: 'chat-completions',
    contextSize: null, outputSize: null, reasoningEffort: '', inputTypes: [] }
  let { app } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light', followSystemTheme: false },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) } })
  try {
    let studio = await openStudio(app)
    const log = () => studio.getByRole('log')
    const picker = () => studio.getByRole('button', { name: 'Conversation', exact: true })
    const menu = () => studio.getByRole('dialog', { name: 'Conversation' })
    const prompt = () => studio.getByLabel('Message the theme assistant')
    const send = async(text: string) => {
      await prompt().fill(text)
      await studio.getByRole('button', { name: 'Send', exact: true }).click()
    }
    await expect(log().getByRole('button')).toHaveCount(0)
    await send('First conversation')
    await expect(log()).toContainText('The text to replace was not found')
    await log().getByText('Error log (1)').click()
    await expect(log().locator('pre')).toHaveText(invalidEdit)
    const dir = await app.evaluate(({ app }) => app.getPath('userData'))
    const output = join(dir, 'failure.json')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async() => ({ canceled: false, filePath: path })
    }, output)
    await log().getByRole('button', { name: 'Export log' }).click()
    await expect.poll(async() => JSON.parse(await readFile(output, 'utf8').catch(() => '{}')).attempts?.[0])
      .toMatchObject({ model: 'theme-test', inputCss: '', assistantText: invalidEdit, reason: 'invalidReply:missingMatch' })
    const { attempts } = JSON.parse(await readFile(output, 'utf8'))
    const [month] = await readdir(join(dir, 'logs'))
    const mainLog = await readFile(join(dir, 'logs', month, 'main.log'), 'utf8')
    expect(mainLog).toContain(attempts[0].requestId)
    expect(mainLog).toContain('invalidReply:missingMatch')
    await log().getByRole('button', { name: 'Retry' }).click()
    await expect(log()).toContainText('Applied once.')
    expect(requests[1]).toEqual(requests[0])
    await expect(log().locator('article.user')).toHaveCount(1)
    await studio.getByRole('button', { name: 'New chat' }).click()
    await expect(log().locator('article')).toHaveCount(0)
    await send('Second conversation')
    await expect(log()).toContainText('Independent reply.')
    expect(requests[2].slice(2)).toEqual([{ role: 'user', content: 'Second conversation' }])
    await app.close()
    const restarted = await launchWithMarkdown('Document', { userDataDir: dir })
    app = restarted.app
    studio = await openStudio(app)
    await expect(log()).toContainText('Independent reply.')
    await picker().click()
    await menu().getByRole('button', { name: 'First conversation', exact: true }).click()
    await expect(log()).toContainText('Applied once.')
    await expect(log()).toContainText('Error log (1)')
    await log().getByRole('button', { name: 'Retract' }).click()
    await expect(prompt()).toHaveValue('First conversation')
    await expect(log().locator('article')).toHaveCount(0)
    await send('Edited first message')
    await expect(log()).toContainText('Replacement reply.')
    expect(requests[3].slice(2)).toEqual([{ role: 'user', content: 'Edited first message' }])
    expect(JSON.parse(requests[3][1].content).css).toBe('')
    await send('Follow-up')
    await expect(log()).toContainText('Follow-up reply.')
    expect(requests[4].slice(2).map(message => message.content)).toEqual(['Edited first message', 'Replacement reply.', 'Follow-up'])
    studio.once('dialog', dialog => dialog.dismiss())
    await log().getByRole('button', { name: 'Retry' }).first().click()
    await expect(log().locator('article.user')).toHaveCount(2)
    studio.once('dialog', dialog => dialog.accept())
    await log().getByRole('button', { name: 'Retry' }).first().click()
    await expect(log()).toContainText('Edited branch.')
    await expect(log().locator('article.user')).toHaveCount(1)
    expect(requests[5]).toEqual(requests[3])
    await picker().click()
    studio.once('dialog', dialog => dialog.accept())
    await menu().getByRole('button', { name: 'Delete chat · Edited first message' }).click()
    await expect(log()).toContainText('Independent reply.')
    await studio.reload()
    await expect(picker()).toHaveText('Second conversation')
    await studio.getByRole('button', { name: 'New chat', exact: true }).click()
    await prompt().fill('Unsent draft')
    await studio.reload()
    await expect(prompt()).toHaveValue('Unsent draft')
    await picker().click()
    const deleteOther = menu().getByRole('button', { name: 'Delete chat · Second conversation' })
    studio.once('dialog', dialog => dialog.dismiss())
    await deleteOther.click()
    await expect(deleteOther).toBeVisible()
    studio.once('dialog', dialog => dialog.accept())
    await deleteOther.click()
    await expect(deleteOther).toHaveCount(0)
    await expect(prompt()).toHaveValue('Unsent draft')
    await expect(log().locator('article')).toHaveCount(0)
    studio.once('dialog', dialog => dialog.accept())
    await menu().getByRole('button', { name: /^Delete chat/ }).click()
    await expect(menu()).toBeHidden()
    await expect(picker()).toBeDisabled()
    await studio.reload()
    await expect(picker()).toBeDisabled()
    expect(requests).toHaveLength(6)
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})
