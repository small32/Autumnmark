import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { clickMenuById, launchElectron } from './helpers'
import { defaultThemeSystemPrompt } from '../../src/shared/themePrompt'

test('the saved system prompt applies to text and tool requests in an open studio', async() => {
  const sent: { messages: { content: string }[]; tools?: unknown[] }[] = []
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    sent.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'Ready.' } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const profile = { id: 'text', model: 'test', baseUrl: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
    inputTypes: [], requestType: 'chat-completions', reasoningEffort: '', contextSize: null, outputSize: null, encryptedKey: '' }
  const { app, page } = await launchElectron([], { preferences: { language: 'en', theme: 'light' },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile, { ...profile, id: 'vision', inputTypes: ['image'] }]) } })
  try {
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const settingsOpened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window', 'ai'))
    const settings = await settingsOpened
    const field = settings.getByLabel('Theme assistant system prompt')
    await expect(field).toHaveValue(defaultThemeSystemPrompt)
    const custom = 'Use short answers.\nDiscuss typographic hierarchy.'
    await field.fill(custom)
    const save = settings.getByRole('button', { name: 'Save', exact: true })
    await save.click()
    await expect(save).toBeDisabled()
    await settings.reload()
    await expect(field).toHaveValue(custom)
    const composer = studio.getByLabel('Message the theme assistant')
    const send = async(question: string, count: number) => {
      await composer.fill(question)
      await composer.press('Enter')
      await expect(studio.getByRole('log').getByRole('button', { name: 'Retry' })).toHaveCount(count)
    }
    await send('First question', 1)
    await studio.getByRole('combobox', { name: 'Model', exact: true }).selectOption('vision')
    await send('Second question', 2)
    expect(sent[0].messages[0].content).toMatch(/^Use short answers\./)
    expect(sent[0].tools).toBeUndefined()
    expect(sent[1].messages[0].content).toContain(custom)
    expect(sent[1].tools).toBeDefined()
    await settings.getByRole('button', { name: 'Restore defaults' }).click()
    await expect(field).toHaveValue(defaultThemeSystemPrompt)
    await send('Third question', 3)
    expect(sent[2].messages[0].content).toContain(defaultThemeSystemPrompt)
    expect(sent[2].messages[0].content).not.toContain(custom)
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})

test('Chinese AI settings display the empty table and classic request type on first open', async() => {
  const { app, page } = await launchElectron([], { preferences: { language: 'zh-CN' } })
  try {
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window', 'ai'))
    const settings = await opened
    const table = settings.getByRole('table', { name: 'AI 模型' })
    await expect(settings.getByRole('button', { name: 'AI 模型', exact: true })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: '请求类型' })).toBeVisible()
    await expect(table.getByText('尚未配置 AI 模型。')).toBeVisible()
    await expect(settings.getByRole('alert')).toHaveCount(0)
    await settings.getByRole('button', { name: '添加模型' }).click()
    await expect(settings.getByRole('dialog').getByLabel('请求类型')).toHaveValue('chat-completions')
  } finally { await app.close() }
})

test('AI settings explain an older main process in the selected language', async() => {
  const { app, page } = await launchElectron([], { preferences: { language: 'zh-CN' } })
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('mt::ai::list')
      ipcMain.removeHandler('mt::i18n::load')
      ipcMain.handle('mt::i18n::load', () => ({ preferences: { title: '偏好设置' } }))
    })
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window', 'ai'))
    const settings = await opened
    const table = settings.getByRole('table', { name: 'AI 模型' })
    await expect(table.getByRole('columnheader', { name: '操作' })).toBeVisible()
    await expect(table.getByRole('alert')).toHaveText('请重新启动 AutumnMark+ 以加载新版模型设置。')
  } finally { await app.close() }
})

test('AI preferences discover, test and manage profiles alongside the original theme model', async() => {
  let answer = '1'
  const received: { path?: string; body: string; auth?: string }[] = []
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    received.push({ path: req.url, body, auth: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/models' && req.method === 'GET') {
      res.end(JSON.stringify({ data: [{ id: 'remote-model' }] }))
    } else if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }))
    } else if (req.url === '/v1/responses' && req.method === 'POST') {
      res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: answer }] }] }))
    } else {
      res.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
  const { app, page } = await launchElectron([], { preferences: { language: 'en' }, userDataFiles: {
    'theme-model.json': JSON.stringify({ endpoint: baseUrl + '/chat/completions', model: 'original', encryptedKey: '' })
  } })
  try {
    const opened = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
    const settings = await opened
    await settings.getByRole('button', { name: 'AI models', exact: true }).click()
    await expect(settings.getByRole('row', { name: /original/ })).toBeVisible()
    await settings.getByRole('button', { name: 'Add model' }).click()
    const dialog = settings.getByRole('dialog')
    await dialog.getByLabel('Display name (optional)').fill('  Reasoning assistant  ')
    for (const input of ['Image', 'PDF', 'Video']) {
      const capability = dialog.getByRole('checkbox', { name: input, exact: true })
      await expect(capability).not.toBeChecked()
      await capability.check()
    }
    const fetchModels = dialog.getByRole('button', { name: 'Fetch models' })
    await expect(fetchModels).toBeDisabled()
    await dialog.getByLabel('API base URL').fill(baseUrl)
    await fetchModels.click()
    await expect(dialog.getByRole('status')).toHaveText('Models found: 1')
    expect(received[0]).toMatchObject({ path: '/v1/models', body: '', auth: undefined })
    await settings.getByRole('option', { name: 'remote-model' }).click()
    await dialog.getByLabel('Reasoning effort').fill('custom-effort')
    await dialog.getByLabel('Context size (tokens)').fill('99001')
    await dialog.getByLabel('Output limit (tokens)').click()
    await settings.getByRole('option', { name: '4096', exact: true }).click()
    const key = process.platform === 'win32' ? 'dummy-local-test-key' : ''
    if (key) await dialog.getByLabel('API key', { exact: true }).fill(key)
    const testDraft = dialog.getByRole('button', { name: 'Test', exact: true })
    await testDraft.click()
    await expect(dialog.getByRole('status')).toContainText('Connected')
    expect(JSON.parse(received[received.length - 1].body)).toEqual({ model: 'remote-model', stream: false, reasoning_effort: 'custom-effort',
      max_completion_tokens: 4096, messages: [{ role: 'user', content: '仅回复1' }] })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await settings.reload()
    const row = settings.getByRole('row', { name: /remote-model/ })
    await expect(row.getByRole('cell').first()).toContainText('Reasoning assistant')
    await row.getByRole('button', { name: 'Test' }).click()
    await expect(row.getByRole('status')).toContainText('Connected')
    if (key) expect(received.at(-1)?.auth).toBe('Bearer ' + key)
    await row.getByRole('button', { name: 'Edit' }).click()
    await expect(dialog.getByLabel('Display name (optional)')).toHaveValue('Reasoning assistant')
    for (const input of ['Image', 'PDF', 'Video']) {
      await expect(dialog.getByRole('checkbox', { name: input, exact: true })).toBeChecked()
    }
    await expect(dialog.getByLabel('API key', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('Context size (tokens)')).toHaveValue('99001')
    if (key) {
      const before = received.length
      await dialog.getByLabel('API base URL').fill(baseUrl + '/other')
      await fetchModels.click()
      await expect(dialog.getByRole('alert')).toContainText('Enter the key for the new endpoint')
      expect(received).toHaveLength(before)
      await dialog.getByLabel('API base URL').fill(baseUrl)
    }
    await dialog.getByLabel('Model ID').fill('manual-model')
    await dialog.getByLabel('Output limit (tokens)').fill('99002')
    await expect(testDraft).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await dialog.getByLabel('Output limit (tokens)').fill('1234')
    answer = 'unexpected'
    await testDraft.click()
    await expect(dialog.getByRole('alert')).toContainText('did not reply with 1')
    expect(JSON.parse(received[received.length - 1].body)).toMatchObject({ model: 'manual-model', max_completion_tokens: 1234 })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Edit' }).click()
    await dialog.getByLabel('Model ID').fill('renamed-model')
    await dialog.getByLabel('Display name (optional)').fill('   ')
    await expect(dialog.getByLabel('Request type')).toHaveValue('chat-completions')
    await dialog.getByLabel('Request type').selectOption('responses')
    answer = '1'
    await testDraft.click()
    await expect(dialog.getByRole('status')).toContainText('Connected')
    expect(received.at(-1)?.path).toBe('/v1/responses')
    expect(JSON.parse(received[received.length - 1].body)).toEqual({ model: 'renamed-model', stream: false, store: false,
      reasoning: { effort: 'custom-effort' }, max_output_tokens: 4096, input: [{ role: 'user', content: '仅回复1' }] })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await settings.reload()
    const renamed = settings.getByRole('row', { name: /renamed-model/ })
    await expect(renamed.getByRole('cell').first()).toHaveText('renamed-model')
    await expect(renamed.getByText('Responses')).toBeVisible()
    await renamed.getByRole('button', { name: 'Test' }).click()
    await expect(renamed.getByRole('status')).toContainText('Connected')
    expect(received.at(-1)?.path).toBe('/v1/responses')
    await renamed.getByRole('button', { name: 'Delete' }).click()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(settings.getByRole('row', { name: /renamed-model/ })).toHaveCount(0)
    await expect(settings.getByRole('row', { name: /original/ })).toBeVisible()
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})
