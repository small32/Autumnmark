import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

test('sidebar AI handles theme and Markdown edits in one conversation and preserves theme history', async() => {
  const documentText = 'PRIVATE_NOTE_TEXT'
  const css = ':root .mu-container h2.mu-atx-heading { color: #246441; }'
  const color = 'rgb(36, 100, 65)'
  const revisedColor = 'rgb(42, 63, 121)'
  const summary = 'Made second-level headings forest green.'
  const followUp = 'Make the headings blue and rename this heading to Updated heading'
  const requests: string[] = []
  const server = createServer(async(req, res) => {
    let body = ''
    for await (const part of req) body += part
    requests.push(body)
    const { messages } = JSON.parse(body)
    const input = JSON.parse(messages.at(-1).content)
    let content = body.includes('#2a3f79') ? 'Made second-level headings blue.' : summary
    if (input.request === followUp && (input.markdown === undefined || input.themeCss === undefined)) {
      content = JSON.stringify({ read: ['markdown', 'themeCss'] })
    } else if (input.request === followUp) {
      content = JSON.stringify({
        reply: 'Suggested a new name and color.',
        themeEdits: [{ find: '#246441', replace: '#2a3f79' }],
        edits: [{ find: '## Heading', replace: '## Updated heading' }],
        capturePreview: true
      })
    } else if (input.request && input.themeCss === undefined) {
      content = JSON.stringify({ read: ['themeCss', 'baseCss'] })
    } else if (input.request) {
      content = JSON.stringify({ reply: 'Updated the heading color.', edits: [], themeEdits: [{ find: '', replace: css }] })
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1'
  const profile = { id: 'editor-theme', model: 'test', encryptedKey: '', baseUrl, requestType: 'chat-completions',
    reasoningEffort: '', contextSize: null, outputSize: null, inputTypes: [] }
  const { app, page } = await launchWithMarkdown(`## Heading\n\n${documentText}`, {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false },
    windowLayout: { showTabBar: true },
    userDataFiles: { 'theme-model.json': JSON.stringify([profile]) }
  })
  try {
    const prefs = () => page.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    const heading = page.locator('.mu-container h2')
    const panel = page.getByRole('tabpanel', { name: 'AI', exact: true })
    const aiTab = page.getByRole('tab', { name: 'AI', exact: true })
    const preview = page.getByRole('button', { name: 'Theme preview active' })
    await clickMenuById(app, 'openAiAssistant')
    await expect(aiTab).toHaveAttribute('aria-selected', 'true')
    await panel.getByLabel('Message the assistant').fill('Make second-level headings forest green')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(heading).toHaveCSS('color', color)
    await expect(preview).toBeVisible()
    await expect(panel.getByRole('alert')).toHaveCount(0)
    expect((await prefs()).theme).toBe('light')
    expect((await prefs()).localThemes ?? []).toHaveLength(0)
    const initial = JSON.parse(JSON.parse(requests[0]).messages.at(-1).content)
    expect(initial).not.toHaveProperty('themeCss')
    expect(initial).not.toHaveProperty('baseCss')
    const styleContext = JSON.parse(JSON.parse(requests[1]).messages.at(-1).content)
    expect(styleContext).toMatchObject({ themeCss: '', baseCss: expect.any(String) })
    expect(styleContext).not.toHaveProperty('markdown')

    const firstTab = page.locator('.editor-tabs .tabs-container > li').first()
    await page.locator('.editor-tabs').getByRole('button', { name: /^new tab$/i }).click()
    await expect(preview).toHaveCount(0)
    await firstTab.click()
    await expect(preview).toBeVisible()
    await expect(heading).toHaveCSS('color', color)

    await page.locator('.mu-container .mu-paragraph').click()
    await page.keyboard.press('End')
    await page.keyboard.insertText(' still writing')
    await expect(page.locator('.mu-container .mu-paragraph')).toContainText('still writing')
    await panel.getByRole('button', { name: 'View this change' }).click()
    const history = page.getByRole('dialog', { name: 'Version history' })
    await expect(history.getByRole('heading', { name: summary })).toBeVisible()
    await expect(history.getByText('#246441', { exact: true })).toBeVisible()
    expect(requests.join('\n')).not.toContain(documentText)
    await history.getByRole('button', { name: 'Close', exact: true }).click()
    await panel.getByRole('button', { name: 'End preview' }).click()
    await expect(heading).not.toHaveCSS('color', color)
    await panel.getByRole('button', { name: 'View this change' }).click()
    await history.getByRole('button', { name: 'Restore as draft' }).click()
    await history.getByRole('button', { name: 'Confirm restore' }).click()
    await history.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(heading).toHaveCSS('color', color)
    await panel.getByRole('button', { name: 'Apply to theme' }).click()
    await expect(panel.getByText('Theme applied.', { exact: true })).toBeVisible()
    await expect(preview).toHaveCount(0)
    const applied = await prefs()
    expect(applied.theme).toMatch(/^local:light:/)
    expect(applied.localThemes).toHaveLength(1)
    expect(applied.localThemes?.[0]).toMatchObject({ id: applied.theme, css })
    await expect(heading).toHaveCSS('color', color)

    await panel.getByLabel('Message the assistant').fill(followUp)
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(heading).toHaveCSS('color', revisedColor)
    await expect(heading).toHaveText(/^(## )?Heading$/)
    await expect(panel.getByText('Updated the heading color.', { exact: true })).toBeVisible()
    await expect(panel.getByText('Suggested a new name and color.', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Preview screenshot 1' })).toBeVisible()
    const followUpRequests = requests.map(body => JSON.parse(body)).filter(request => {
      const input = JSON.parse(request.messages.at(-1).content)
      return input.request === followUp
    })
    expect(followUpRequests).toHaveLength(2)
    const [, combined] = followUpRequests
    expect(combined.messages.slice(1, -1).map((message: { content: string }) => message.content)).toEqual([
      'Make second-level headings forest green', 'Updated the heading color.'
    ])
    expect(JSON.parse(combined.messages.at(-1).content)).toMatchObject({
      request: followUp, markdown: expect.stringContaining(documentText), themeCss: css
    })
    expect(JSON.parse(combined.messages.at(-1).content)).not.toHaveProperty('baseCss')
    await panel.locator('details summary').click()
    await panel.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await expect(heading).toHaveText(/^(## )?Updated heading$/)
    await panel.getByRole('button', { name: 'Apply to theme' }).click()
    await expect(panel.getByText('Theme applied.', { exact: true })).toBeVisible()
    expect((await prefs()).theme).toBe(applied.theme)
    expect((await prefs()).localThemes).toHaveLength(1)

    const openingSettings = app.waitForEvent('window')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window', 'theme'))
    const settings = await openingSettings
    const openingStudio = app.waitForEvent('window')
    await settings.getByRole('button', { name: 'Edit current theme' }).click()
    const studio = await openingStudio
    await studio.getByRole('button', { name: 'Version history' }).click()
    const shared = studio.getByRole('dialog', { name: 'Version history' })
    await expect(shared.getByRole('navigation').getByText(summary, { exact: true })).toBeVisible()
    await expect(shared.getByRole('navigation').getByText('Save and apply', { exact: true })).toHaveCount(2)

    await clickMenuById(app, 'light')
    await expect.poll(async() => (await prefs()).theme).toBe('light')
    await expect(heading).not.toHaveCSS('color', revisedColor)
    expect((await prefs()).localThemes).toHaveLength(1)
  } finally {
    server.closeAllConnections()
    server.close()
    await app.close()
  }
})
