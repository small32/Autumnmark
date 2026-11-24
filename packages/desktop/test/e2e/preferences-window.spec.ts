import { expect, test } from '@playwright/test'
import en from '../../static/locales/en.json'
import type { ElectronApplication, Page } from 'playwright'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { themeCatalogBase } from '../../src/shared/themeCatalog'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const openSettings = async(app: ElectronApplication, editor: Page): Promise<Page> => {
  const opened = app.waitForEvent('window')
  await editor.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
  const settings = await opened
  await expect(settings.locator('.pref-general h4')).toBeVisible()
  await expect(settings.locator('.pref-sidebar input')).toBeVisible()
  return settings
}

const closeSettings = async(app: ElectronApplication, settings: Page): Promise<void> => {
  const window = await app.browserWindow(settings)
  const closed = settings.waitForEvent('close')
  await window.evaluate(window => window.close())
  await closed
}

const preferences = async(app: ElectronApplication): Promise<Record<string, unknown>> => {
  const directory = await app.evaluate(({ app }) => app.getPath('userData'))
  return JSON.parse(readFileSync(join(directory, 'preferences.json'), 'utf8'))
}

test('the settings button reveals the prepared window without stealing focus on hover', async() => {
  const { app, page } = await launchWithMarkdown('# Preferences\n', {
    windowLayout: { showSideBar: true },
    preferences: { language: 'zh-CN' },
    suppressErrorDialog: true
  })
  try {
    const gear = page.locator('.settings-button')
    const editor = await app.browserWindow(page)
    await editor.evaluate(win => win.focus())
    const prepared = app.waitForEvent('window')
    await gear.hover()
    const settings = await prepared
    const native = await app.browserWindow(settings)
    await expect(settings.locator('.pref-general h4')).toHaveText('通用')
    expect(await native.evaluate(win => win.isVisible())).toBe(false)
    expect(await editor.evaluate(win => win.isFocused())).toBe(true)
    await gear.click()
    await expect.poll(() => native.evaluate(win => win.isVisible())).toBe(true)
    await settings.locator('.pref-sidebar input').fill('autoSave')
    await expect(settings.locator('.pref-autocomplete li').first()).toBeVisible()
    expect(app.windows()).toHaveLength(2)
    await closeSettings(app, settings)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('opening settings after a preference change uses a fresh window and the requested category', async() => {
  const { app, page } = await launchWithMarkdown('# Preferences\n', {
    windowLayout: { showSideBar: true },
    preferences: { language: 'en', autoSave: false },
    suppressErrorDialog: true
  })
  try {
    const editor = await app.browserWindow(page)
    await editor.evaluate(win => win.focus())
    const prepared = app.waitForEvent('window')
    await page.locator('.settings-button').focus()
    const oldSettings = await prepared
    await expect(oldSettings.locator('.pref-general h4')).toHaveText('General')
    const closed = oldSettings.waitForEvent('close')
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { autoSave: true }))
    await closed

    const opened = app.waitForEvent('window')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('app-create-settings-window', 'files'))
    const settings = await opened
    await expect(settings.getByRole('switch', { name: 'Auto save', exact: true })).toBeChecked()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the full settings window indexes searchable controls without renderer exceptions', async() => {
  const { app, page } = await launchWithMarkdown('# Preferences\n', {
    preferences: { language: 'en', autoSave: false },
    suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('auto')
    await expect(settings.locator('.pref-autocomplete li').first()).toBeVisible()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('compact limits apply live and each tab remembers its expanded blocks', async() => {
  const code = ['```', ...Array.from({ length: 24 }, (_, i) => String(i)), '```', ''].join('\n')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="800"/>').toString('base64')
  const videoUrl = pathToFileURL(join(__dirname, 'data', 'portrait.mp4')).href
  const markdown = code + '\n![tall](data:image/svg+xml;base64,' + svg + ')\n\n<video src="' + videoUrl + '"></video>\n'
  const { app, page } = await launchWithMarkdown(markdown, { preferences: { language: 'en' } })
  try {
    const toggle = page.locator('.mu-code-block .mu-compact-toggle')
    const image = page.locator('.mu-paragraph-content').filter({ has: page.locator('.mu-embedded-image img') })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => image.evaluate(el => el.clientHeight)).toBeGreaterThan(320)
    const settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('compactMode')
    await settings.locator('.pref-autocomplete li').first().click()
    const mode = settings.locator('#setting-compactMode').getByRole('switch')
    const height = settings.locator('#setting-compactImageMaxHeight input')
    const videoHeight = settings.locator('#setting-compactVideoMaxHeight input')
    const video = page.locator('.editor-component .mu-embedded-video video')
    const rows = settings.locator('#setting-compactCodeMaxLines input')
    await expect(mode).toBeChecked()
    await expect(height).toHaveValue('0')
    await expect(videoHeight).toHaveValue('0')
    await expect(rows).toHaveValue('12')
    await mode.locator('..').click()
    await expect(rows).toBeDisabled()
    await expect(videoHeight).toBeDisabled()
    await expect(toggle).toHaveCount(0)
    const fullVideoHeight = await video.evaluate(el => el.clientHeight)
    await mode.locator('..').click()
    await height.fill('200')
    await height.press('Tab')
    await expect.poll(() => image.evaluate(el => el.clientHeight)).toBe(200)
    await expect.poll(() => video.evaluate(el => el.clientHeight)).toBe(fullVideoHeight)
    await videoHeight.fill('150')
    await videoHeight.press('Tab')
    await expect.poll(() => video.evaluate(el => [el.clientWidth, el.clientHeight])).toEqual([100, 150])
    await expect.poll(() => image.evaluate(el => el.clientHeight)).toBe(200)
    await rows.fill('30')
    await rows.press('Tab')
    await expect(toggle).toHaveCount(0)
    await rows.fill('4')
    await rows.press('Tab')
    await expect(toggle).toBeVisible()
    await height.fill('0')
    await height.press('Tab')
    await expect.poll(() => image.evaluate(el => el.clientHeight)).toBeGreaterThan(320)
    await expect.poll(() => video.evaluate(el => el.clientHeight)).toBe(150)
    await expect(toggle).toBeVisible()
    await videoHeight.fill('0')
    await videoHeight.press('Tab')
    await expect.poll(() => video.evaluate(el => el.clientHeight)).toBe(fullVideoHeight)
    await rows.fill('0')
    await rows.press('Tab')
    await expect(toggle).toHaveCount(0)
    await expect.poll(() => preferences(app)).toMatchObject({ compactMode: true, compactImageMaxHeight: 0, compactCodeMaxLines: 0, compactVideoMaxHeight: 0 })
    await height.fill('200')
    await height.press('Tab')
    await expect.poll(() => image.evaluate(el => el.clientHeight)).toBe(200)
    await videoHeight.fill('150')
    await videoHeight.press('Tab')
    await rows.fill('4')
    await rows.press('Tab')
    await expect(toggle).toBeVisible()
    await expect.poll(() => preferences(app)).toMatchObject({ compactMode: true, compactCodeMaxLines: 4, compactVideoMaxHeight: 150 })
    await closeSettings(app, settings)
    await toggle.click()
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, code)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await sendIpcToRenderer(app, 'mt::switch-tab-by-index', 0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await app.close()
  }
})

test('settings search focuses the exact control, including repeated selections', async() => {
  const { app, page } = await launchWithMarkdown('# Search preferences\n', {
    preferences: { language: 'en' }, suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    const search = settings.locator('.pref-sidebar input')
    for (let attempt = 0; attempt < 2; attempt++) {
      await search.fill('editorLineWidth')
      await settings.locator('.pref-autocomplete').getByText(en.preferences.editor.textEditor.maxWidth, { exact: true }).click()
      await expect(settings.locator('#setting-editorLineWidth')).toBeFocused()
      await expect(settings.locator('#setting-editorLineWidth input')).toBeVisible()
      // Autocomplete defers blur handling; finish closing before the next search.
      await expect(settings.locator('.pref-autocomplete')).toBeHidden()
    }
    await search.fill('imageRelativeDirectoryName')
    await settings.locator('.pref-autocomplete').getByText(en.preferences.image.folderSetting.relativeFolderName, { exact: true }).click()
    await expect(settings.locator('#setting-imageRelativeDirectoryName')).toBeFocused()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('unified search finds shortcuts before their page opens and reveals their functional group', async() => {
  const { app, page } = await launchWithMarkdown('# Shortcut search\n', {
    preferences: { language: 'en' }, suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('file.save')
    await settings.locator('.pref-autocomplete li').first().click()
    const command = settings.locator('[id="setting-keybinding-file.save"]')
    await expect(command).toBeFocused()
    await expect(settings.getByRole('region', { name: 'File', exact: true }).locator('[id="setting-keybinding-file.save"]')).toBeVisible()
    await expect(settings.locator('.pref-keybindings input:not([type="hidden"]):visible')).toHaveCount(0)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('shortcut conflict notices name and reveal the command occupying the binding', async() => {
  const { app, page } = await launchWithMarkdown('# Conflicting shortcuts\n', {
    preferences: { language: 'en' }, suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('file.save')
    await settings.locator('.pref-autocomplete li').first().click()
    const row = settings.locator('[id="setting-keybinding-file.save"]').locator('xpath=ancestor::li')
    await row.getByRole('button', { name: 'Edit shortcut for Save', exact: true }).click()
    const recorder = settings.locator('.shortcut-recorder')
    await recorder.press(process.platform === 'darwin' ? 'Meta+O' : 'Control+O')
    const notice = settings.locator('.mt-notification')
    await expect(notice.locator('.mt-notification__text')).toContainText('Open')
    await notice.getByRole('button', { name: /^View / }).click()
    await expect(settings.locator('[id="setting-keybinding-file.open-file"]')).toBeFocused()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('the Theme settings page keeps fixed and system choices separate and preserves custom CSS', async() => {
  const { app, page } = await launchWithMarkdown('# Theme choices\n', {
    preferences: {
      language: 'en', theme: 'light', followSystemTheme: false,
      lightModeTheme: 'light', darkModeTheme: 'dark', customCss: '/* retained */'
    }, suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    const categories = settings.locator('.pref-sidebar .category')
    await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
    await expect(settings.locator('#setting-theme')).toHaveCount(0)
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window', 'theme'))
    await expect(categories.getByRole('button', { name: 'Theme', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(settings.locator('.theme-card')).toHaveCount(33)
    await settings.getByRole('textbox', { name: 'Search themes', exact: true }).fill('Dracula')
    await expect(settings.locator('.theme-card')).toHaveCount(1)
    await settings.getByRole('button', { name: 'Apply · Dracula', exact: true }).click()
    await expect.poll(async() => (await preferences(app)).theme).toBe('dracula')
    await expect(page.locator('body')).toHaveClass(/dark/)
    await settings.getByRole('button', { name: 'Follow system appearance', exact: true }).click()
    await settings.locator('#setting-lightModeTheme').click()
    await expect(settings.getByRole('heading', { name: 'Dracula', exact: true })).toHaveCount(0)
    await settings.getByRole('button', { name: /(?:Apply|Set as light theme) · Solarized Light/ }).click()
    await expect.poll(() => preferences(app)).toMatchObject({ lightModeTheme: 'solarized-light', darkModeTheme: 'dark' })
    await settings.locator('#setting-darkModeTheme').click()
    await expect(settings.getByRole('heading', { name: 'Solarized Light', exact: true })).toHaveCount(0)
    await settings.getByRole('button', { name: /(?:Apply|Set as dark theme) · Nord/ }).click()
    await expect.poll(() => preferences(app)).toMatchObject({ lightModeTheme: 'solarized-light', darkModeTheme: 'nord' })
    await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
    await settings.locator('.pref-sidebar input').fill('customCss')
    await settings.locator('.pref-autocomplete li').first().click()
    await expect(settings).toHaveURL(/preference\/theme/)
    await expect(settings.locator('#setting-customCss')).toHaveAttribute('open', '')
    await expect(settings.locator('.custom-css-input')).toHaveValue('/* retained */')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('theme preview compares and switches samples before applying a local theme', async() => {
  const { app, page } = await launchWithMarkdown('# Theme preview\n', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false },
    suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Theme', exact: true }).click()
    await settings.getByRole('button', { name: 'Preview · Nord', exact: true }).click()
    const dialog = settings.getByRole('dialog', { name: 'Theme preview' })
    const nord = dialog.frameLocator('iframe[title="Nord"]')
    await expect(nord.locator('h1')).toContainText('Ridge notes')
    await expect(nord.locator('body')).toHaveCSS('background-color', 'rgb(46, 52, 64)')
    await expect(nord.locator('h6')).toContainText('Recording convention')
    await expect(nord.locator('.mu-table-row')).toHaveCount(4)
    await expect(nord.locator('.mu-task-list-item')).toHaveCount(3)
    await expect(nord.locator('.mu-github-alert')).toHaveCount(1)
    await expect(nord.locator('.mu-math-block')).toHaveCount(1)
    await expect(nord.locator('.mu-footnote')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Compare with current theme' }).click()
    const current = dialog.frameLocator('iframe[title="GitBook Teal"]')
    await expect(current.locator('h1')).toContainText('Ridge notes')
    await dialog.getByRole('button', { name: 'Markdown source', exact: true }).click()
    for (const frame of [current, nord]) {
      await expect(frame.locator('.CodeMirror-line').first()).toContainText('# Ridge notes')
      await expect(frame.locator('main')).toBeHidden()
    }
    const picker = dialog.getByRole('combobox', { name: 'Choose theme', exact: true })
    await picker.click()
    await picker.fill('Graphite')
    await picker.press('Space')
    await expect(dialog).toBeVisible()
    await expect(picker).toHaveValue('Graphite ')
    await picker.fill('Graphite')
    await settings.getByRole('option', { name: 'Graphite', exact: true }).click()
    await expect(dialog.frameLocator('iframe[title="Graphite"]').locator('.CodeMirror-line').first()).toContainText('# Ridge notes')
    await dialog.click({ position: { x: 5, y: 5 } })
    await expect(dialog).toBeHidden()
    expect((await preferences(app)).theme).toBe('light')

    await settings.getByRole('button', { name: 'Preview · Graphite', exact: true }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).press('Space')
    await expect(dialog).toBeHidden()
    expect((await preferences(app)).theme).toBe('light')

    await settings.getByRole('button', { name: 'Preview · Graphite', exact: true }).click()
    await dialog.frameLocator('iframe[title="Graphite"]').locator('h1').click()
    await settings.keyboard.press('Space')
    await expect(dialog).toBeHidden()
    expect((await preferences(app)).theme).toBe('light')

    await settings.getByRole('button', { name: 'Preview · Graphite', exact: true }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async() => (await preferences(app)).theme).toBe('graphite')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('online themes install, apply, update and uninstall through the local theme library', async() => {
  const { app, page } = await launchWithMarkdown('# Online themes\n', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false },
    suppressErrorDialog: true
  })
  try {
    const assets = [1, 2].map(revision => {
      const file = JSON.stringify({
        version: 1, id: 'local:nord:21111111-2222-4333-8444-555555555555',
        name: 'Evening Paper', base: 'nord', values: { accent: revision === 1 ? '#aa8855' : '#aabbcc' }
      })
      const entry = {
        id: 'evening-paper', revision, name: 'Evening Paper', author: 'Antumnmark+', base: 'nord',
        path: `themes/evening-paper/${revision}/theme.theme.json`,
        sha256: createHash('sha256').update(file).digest('hex')
      }
      return { file, entry }
    })
    const morningFile = JSON.stringify({
      version: 1, id: 'local:light:21111111-2222-4333-8444-555555555555',
      name: 'Morning Paper', base: 'light', values: { accent: '#32805e' }
    })
    const morning = { file: morningFile, entry: {
      id: 'morning-paper', revision: 1, name: 'Morning Paper', author: 'Antumnmark+', base: 'light',
      path: 'themes/morning-paper/1/theme.theme.json',
      sha256: createHash('sha256').update(morningFile).digest('hex')
    } }
    const source = await app.evaluateHandle(({ net }, { assets, morning, catalogBase }) => {
      const state = { revision: 1, offline: false }
      const fetch = net.fetch.bind(net)
      net.fetch = (input, options) => {
        const url = new URL(typeof input === 'string' ? input : input.url)
        if (!url.href.startsWith(catalogBase)) return fetch(input, options)
        if (state.offline) return Promise.resolve(new Response('', { status: 503 }))
        const current = assets[state.revision - 1]
        return Promise.resolve(url.pathname.endsWith('/catalog.json')
          ? Response.json({ version: 1, themes: [current.entry, morning.entry] })
          : new Response(url.pathname.endsWith(morning.entry.path) ? morning.file : current.file))
      }
      return state
    }, { assets, morning, catalogBase: themeCatalogBase })
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Theme', exact: true }).click()
    await settings.getByRole('button', { name: 'Online themes', exact: true }).click()
    await settings.getByRole('button', { name: 'Install only · Evening Paper', exact: true }).click()
    await expect.poll(() => preferences(app)).toMatchObject({
      theme: 'light',
      localThemes: [{ name: 'Evening Paper', catalog: { id: 'evening-paper', revision: 1 } }]
    })

    await source.evaluate(state => { state.offline = true })
    await settings.getByRole('button', { name: 'Refresh online themes', exact: true }).click()
    await expect(settings.getByText('Showing the last downloaded catalog.')).toBeVisible()
    await settings.getByRole('button', { name: 'Local themes', exact: true }).click()
    await settings.getByRole('textbox', { name: 'Search themes', exact: true }).fill('Evening Paper')
    await settings.getByRole('button', { name: 'Apply · Evening Paper', exact: true }).click()
    const activeId = /^local:nord:/
    await expect.poll(() => preferences(app)).toMatchObject({ theme: expect.stringMatching(activeId) })
    await expect(page.locator('body')).toHaveClass(/dark/)
    const chosen = (await preferences(app)).theme

    await source.evaluate(state => { state.revision = 2; state.offline = false })
    await settings.getByRole('button', { name: 'Online themes', exact: true }).click()
    await settings.getByRole('button', { name: 'Refresh online themes', exact: true }).click()
    await settings.getByRole('button', { name: 'Update · Evening Paper', exact: true }).click()
    await expect.poll(() => preferences(app)).toMatchObject({
      theme: chosen,
      localThemes: [{ id: chosen, values: { accent: '#aabbcc' }, catalog: { revision: 2 } }]
    })
    await expect.poll(() => page.locator('html').evaluate(element =>
      getComputedStyle(element).getPropertyValue('--themeColor').trim()
    )).toBe('#aabbcc')
    await settings.getByRole('button', { name: 'Preview · Morning Paper', exact: true }).click()
    const preview = settings.getByRole('dialog', { name: 'Theme preview' })
    const sample = preview.frameLocator('iframe[title="Morning Paper"]')
    await expect(sample.locator('h1')).toContainText('Ridge notes')
    await expect.poll(() => sample.locator('html').evaluate(element =>
      getComputedStyle(element).getPropertyValue('--themeColor').trim()
    )).toBe('#32805e')
    expect(await preferences(app)).toMatchObject({
      theme: chosen,
      localThemes: [{ id: chosen, catalog: { revision: 2 } }]
    })
    await preview.getByRole('button', { name: 'Install and apply', exact: true }).click()
    await expect.poll(() => preferences(app)).toMatchObject({
      theme: expect.stringMatching(/^local:light:/),
      localThemes: expect.arrayContaining([expect.objectContaining({ name: 'Morning Paper' })])
    })
    await expect(page.locator('body')).not.toHaveClass(/dark/)
    await settings.getByRole('button', { name: 'Local themes', exact: true }).click()
    await settings.getByRole('button', { name: 'Uninstall theme · Morning Paper', exact: true }).click()
    const confirmation = settings.getByRole('dialog', { name: 'Uninstall theme' })
    await confirmation.getByRole('button', { name: 'Uninstall theme', exact: true }).click()
    await expect.poll(() => preferences(app)).toMatchObject({
      theme: 'light',
      localThemes: [{ id: chosen, catalog: { revision: 2 } }]
    })
    await settings.getByRole('button', { name: 'Online themes', exact: true }).click()
    await expect(settings.getByRole('button', { name: 'Install only · Morning Paper', exact: true })).toBeVisible()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('deleting an active custom theme restores its base in each selected slot', async() => {
  const id = 'local:nord:21111111-2222-4333-8444-555555555555'
  const retained = {
    version: 1, id: 'local:light:21111111-2222-4333-8444-555555555556',
    name: 'Another theme', base: 'light', values: {}
  }
  const { app, page } = await launchWithMarkdown('# Custom themes\n', {
    preferences: {
      language: 'en', theme: id, lightModeTheme: 'graphite', darkModeTheme: id, followSystemTheme: false,
      localThemes: [{ version: 1, id, name: 'Ink and Mist', base: 'nord', values: {} }, retained]
    },
    suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Theme', exact: true }).click()
    const nord = settings.locator('.theme-card').filter({ has: settings.getByRole('heading', { name: 'Nord', exact: true }) })
    await expect(nord.getByRole('button', { name: /Delete theme|Uninstall theme/ })).toHaveCount(0)
    const trigger = settings.getByRole('button', { name: 'Delete theme · Ink and Mist', exact: true })
    await trigger.click()
    const confirmation = settings.getByRole('dialog', { name: 'Delete theme' })
    await expect(confirmation).toContainText('Theme selections that use it will switch to Nord.')
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(trigger).toBeVisible()
    await trigger.click()
    await confirmation.getByRole('button', { name: 'Delete theme', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(trigger).toHaveCount(0)
    await expect.poll(() => preferences(app)).toMatchObject({
      theme: 'nord', lightModeTheme: 'graphite', darkModeTheme: 'nord', localThemes: [retained]
    })
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('Pandoc and PicGo share explicit checking, found, missing and failed states', async() => {
  const { app, page } = await launchWithMarkdown('# Command detection\n', {
    preferences: { language: 'en', imageInsertAction: 'upload' }, suppressErrorDialog: true
  })
  try {
    const probes = await app.evaluateHandle(({ ipcMain }) => {
      const state = {
        picgo: false,
        pandoc: null as string | null,
        fail: false,
        block: false,
        release: undefined as ((found: boolean) => void) | undefined
      }
      ipcMain.removeHandler('mt::pandoc::command')
      ipcMain.handle('mt::pandoc::command', () => ({ command: state.pandoc }))
      ipcMain.removeHandler('mt::cmd::exists')
      ipcMain.handle('mt::cmd::exists', (_event, name: string) => {
        if (name !== 'picgo') return true
        if (state.fail) throw new Error('Simulated command detection failure')
        if (state.block) return new Promise<boolean>(resolve => { state.release = resolve })
        return state.picgo
      })
      return state
    })
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Images & export', exact: true }).click()
    const pandoc = settings.locator('.pref-general .command-detection')
    const picgo = settings.locator('.picgo .command-detection')
    await expect(pandoc).toHaveAttribute('data-state', 'not-found')
    await expect(picgo).toHaveAttribute('data-state', 'not-found')
    await probes.evaluate(state => { state.picgo = true; state.pandoc = '/test/pandoc'; state.block = true })
    await picgo.getByRole('button', { name: 'Check again', exact: true }).click()
    await expect(picgo).toHaveAttribute('data-state', 'checking')
    await expect(picgo.getByRole('status')).toHaveText('Checking…')
    await expect(picgo.getByRole('button')).toBeDisabled()
    await probes.evaluate(state => { state.block = false; state.release?.(state.picgo) })
    await expect(picgo).toHaveAttribute('data-state', 'found')
    await pandoc.getByRole('button', { name: 'Check again', exact: true }).click()
    await expect(pandoc).toHaveAttribute('data-state', 'found')
    await expect(pandoc.getByRole('status')).toContainText('/test/pandoc')
    await probes.evaluate(state => { state.fail = true })
    await picgo.getByRole('button', { name: 'Check again', exact: true }).click()
    await expect(picgo).toHaveAttribute('data-state', 'failed')
    await settings.locator('.debug-info summary').click()
    await expect(settings.locator('.debug-info pre')).toContainText('Simulated command detection failure')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('uploader keeps its complete offline guide and persists a custom script', async() => {
  const { app, page } = await launchWithMarkdown('# Uploader settings\n', {
    preferences: { language: 'en', imageInsertAction: 'path' }, suppressErrorDialog: true
  })
  try {
    let settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('imageUploader')
    await settings.locator('.pref-autocomplete li').first().click()
    const guide = settings.locator('.uploader-guide')
    await expect(guide).not.toHaveAttribute('open', '')
    await guide.locator('summary').click()
    await expect(guide.locator('code').filter({ hasText: 'picgo set uploader' })).toBeVisible()
    await expect(guide.locator('code').filter({ hasText: 'picgo config' })).toBeVisible()
    await settings.locator('#setting-imageUploader .el-select__wrapper').click()
    await settings.getByRole('option', { name: 'CLI Script', exact: true }).click()
    const script = settings.locator('#setting-cliScript input')
    await script.fill(process.execPath)
    const dataDirectory = await app.evaluate(({ app }) => app.getPath('userData'))
    const savedScript = () => JSON.parse(readFileSync(join(dataDirectory, 'dataCenter.json'), 'utf8')).cliScript
    await expect.poll(savedScript).toBe(process.execPath)
    await expect(settings.locator('#setting-imageUploader').getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(settings.locator('#setting-cliScript .el-input__wrapper')).toHaveCSS('height', '36px')
    await expect(settings.locator('#setting-imageUploader .el-select__wrapper')).toHaveCSS('height', '36px')
    await script.fill(join(dataDirectory, 'missing-script'))
    await expect(settings.locator('#setting-cliScript [role="alert"]')).toBeVisible()
    expect(savedScript()).toBe(process.execPath)
    await expect.poll(async() => (await preferences(app)).imageInsertAction).toBe('path')
    await closeSettings(app, settings)
    await expect.poll(() => app.windows().length).toBe(1)
    settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('imageUploader')
    await settings.locator('.pref-autocomplete li').first().click()
    await expect(settings.locator('#setting-cliScript input')).toHaveValue(process.execPath)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('image insertion behavior switches its related settings and preserves search access', async() => {
  const { app, page } = await launchWithMarkdown('# Image settings\n', {
    preferences: { language: 'en', imageInsertAction: 'path' }, suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Images & export', exact: true }).click()
    await expect(settings.getByRole('heading', { name: 'Image', exact: true })).toBeVisible()
    const folder = settings.locator('.image-folder')
    const uploader = settings.locator('#setting-imageUploader')
    await expect(folder).toBeVisible()
    await expect(uploader).toHaveCount(0)
    const chooseAction = async(label: string) => {
      await settings.locator('#setting-imageInsertAction .el-select__wrapper').click()
      await settings.getByRole('option', { name: label, exact: true }).click()
    }
    await chooseAction('Embed in Markdown (Base64)')
    await expect.poll(async() => (await preferences(app)).imageInsertAction).toBe('embed')
    await expect(folder).toHaveCount(0)
    await expect(uploader).toHaveCount(0)
    await chooseAction('Upload to cloud')
    await expect(uploader).toBeVisible()
    await expect(folder).toHaveCount(0)
    await expect.poll(async() => (await preferences(app)).imageInsertAction).toBe('upload')
    await settings.locator('.pref-sidebar input').fill('imageRelativeDirectoryBase')
    await settings.locator('.pref-autocomplete li').first().click()
    const copyLocation = settings.locator('#setting-imageRelativeDirectoryBase')
    await expect(copyLocation).toBeFocused()
    await expect(copyLocation.getByRole('combobox', { name: 'Copy image relative to', exact: true })).toBeVisible()
    await expect.poll(async() => (await preferences(app)).imageInsertAction).toBe('upload')
    await chooseAction('Copy to folder')
    await expect(folder).toBeVisible()
    await expect(uploader).toHaveCount(0)
    await chooseAction('Use absolute path')
    await expect(folder).toBeVisible()
    await expect(uploader).toHaveCount(0)
    await settings.locator('.pref-sidebar input').fill('imageUploader')
    await settings.locator('.pref-autocomplete li').first().click()
    await expect(uploader).toBeFocused()
    await expect.poll(async() => (await preferences(app)).imageInsertAction).toBe('path')
    await chooseAction('Copy to folder')
    await expect(uploader).toHaveCount(0)
    await expect(folder).toBeVisible()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('file-tree rule tags retain glob commas when adding and reopening settings', async() => {
  const { app, page } = await launchWithMarkdown('# Exclusion rules\n', {
    preferences: { language: 'en', treePathExcludePatterns: ['**/{drafts,archive}/**'] },
    suppressErrorDialog: true
  })
  try {
    let settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'General', exact: true }).click()
    const rules = settings.locator('.exclude-patterns')
    await expect(rules.locator('.el-tag__content')).toHaveText(['**/{drafts,archive}/**'])
    const input = rules.getByRole('textbox', { name: 'New exclusion rule', exact: true })
    await input.fill(' **/{cache,backup}/** ')
    await input.press('Enter')
    await expect.poll(async() => (await preferences(app)).treePathExcludePatterns)
      .toEqual(['**/{drafts,archive}/**', ' **/{cache,backup}/** '])
    await rules.locator('.el-tag__close').first().click()
    await expect.poll(async() => (await preferences(app)).treePathExcludePatterns)
      .toEqual([' **/{cache,backup}/** '])
    await closeSettings(app, settings)
    await expect.poll(() => app.windows().length).toBe(1)
    settings = await openSettings(app, page)
    await settings.locator('.pref-sidebar input').fill('treePathExcludePatterns')
    await settings.locator('.pref-autocomplete li').first().click()
    await expect(settings).toHaveURL(/preference\/general/)
    await expect(settings.locator('#setting-treePathExcludePatterns')).toBeFocused()
    await expect(settings.locator('.exclude-patterns .el-tag__content'))
      .toHaveText([' **/{cache,backup}/** '])
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('actual settings clicks persist autosave and language and update the editor', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Before\n', {
    preferences: { language: 'en', autoSave: false, autoSaveDelay: 1000 },
    suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Files & saving', exact: true }).click()
    const autoSave = settings.getByRole('switch', { name: 'Auto save', exact: true })
    await expect(autoSave).not.toBeChecked()
    await autoSave.locator('..').click()
    await expect(autoSave).toBeChecked()
    await expect.poll(async() => (await preferences(app)).autoSave).toBe(true)

    await settings.getByRole('button', { name: 'General', exact: true }).click()
    const language = settings.locator('.pref-select-item').filter({
      has: settings.getByRole('combobox', { name: 'Interface language', exact: true })
    })
    await language.locator('.el-select__wrapper').click()
    await settings.getByRole('option', { name: '简体中文', exact: true }).click()
    await expect(settings.locator('.pref-general h4')).toHaveText('通用')
    await expect.poll(async() => (await preferences(app)).language).toBe('zh-CN')
    await settings.getByRole('button', { name: '文件与保存', exact: true }).click()
    await expect(settings.getByRole('switch', { name: '自动保存', exact: true })).toBeChecked()

    await page.locator('[contenteditable=true]').first().fill('Saved after enabling autosave')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('Saved after enabling autosave')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})


test('startup settings use shared controls and persist policy, switches and folder selection', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Startup settings\n', {
    preferences: { language: 'en', autoSave: false },
    suppressErrorDialog: true
  })
  try {
    const settings = await openSettings(app, page)
    await settings.getByRole('button', { name: 'Files & saving', exact: true }).click()
    const startup = settings.locator('.recovery-settings')
    await expect(startup.locator('h6.title')).toHaveText('Startup and recovery')
    await expect(startup.locator('.el-switch')).toHaveCount(3)
    await expect(startup.locator('select')).toHaveCount(0)
    await expect(startup.locator('.startup-directory')).toHaveCount(0)
    await startup.locator('.el-select__wrapper').click()
    await settings.getByRole('option', { name: 'Restore the last active window', exact: true }).click()
    await expect.poll(async() => (await preferences(app)).startUpAction).toBe('restoreLastWindow')
    await expect(startup.locator('.startup-directory')).toHaveCount(0)
    const restoreFiles = startup.getByRole('switch', { name: 'Restore opened files', exact: true })
    await restoreFiles.locator('..').click()
    await expect(restoreFiles).not.toBeChecked()
    await expect.poll(async() => (await preferences(app)).restoreEditors).toBe(false)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [folder] })
    }, dirname(filePath))
    await startup.locator('.el-select__wrapper').click()
    await settings.getByRole('option', { name: 'Open the selected folder', exact: true }).click()
    await expect(startup.locator('.startup-directory')).toBeVisible()
    await startup.getByRole('button', { name: 'Select Folder', exact: true }).click()
    await expect.poll(() => preferences(app)).toMatchObject({
      startUpAction: 'folder', defaultDirectoryToOpen: dirname(filePath), restoreEditors: false
    })
    await expect(startup.locator('.startup-directory')).toContainText(dirname(filePath))
    await startup.locator('.el-select__wrapper').click()
    await settings.getByRole('option', { name: 'New blank document', exact: true }).click()
    await expect(startup.locator('.startup-directory')).toHaveCount(0)
    await expect.poll(() => preferences(app)).toMatchObject({
      startUpAction: 'blank', defaultDirectoryToOpen: dirname(filePath)
    })
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
