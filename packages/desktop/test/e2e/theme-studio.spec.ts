import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { clickMenuById, launchWithMarkdown } from './helpers'

async function openSettings(app: ElectronApplication, page: Page): Promise<Page> {
  const opened = app.waitForEvent('window')
  await page.evaluate(() => window.electron.ipcRenderer.send('mt::open-setting-window'))
  const settings = await opened
  await settings.getByRole('button', { name: 'Theme', exact: true }).click()
  return settings
}

async function openStudio(app: ElectronApplication, settings: Page, edit = false): Promise<Page> {
  const opened = app.waitForEvent('window')
  await settings.getByRole('button', { name: edit ? 'Edit current theme' : 'Create from current theme' }).click()
  const studio = await opened
  await expect(studio.locator('.theme-studio')).toBeVisible()
  return studio
}

const layout = ':root .mu-container h2:is(.mu-atx-heading, .mu-setext-heading) { margin-top: 47px; }'
test('the Theme menu opens the current theme with a visible editor and rendered preview', async() => {
  const { app, page } = await launchWithMarkdown('Document', { preferences: {
    language: 'zh-CN', theme: 'nord', followSystemTheme: false
  } })
  try {
    const menuItems = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('themeMenu')?.submenu?.items.map(({ id, label }) => ({ id, label }))
    )
    expect(menuItems?.[0]).toEqual({ id: 'openThemeSettings', label: '主题设置…' })
    expect(menuItems).toContainEqual({ id: 'createThemeFromCurrent', label: '基于当前主题创建' })
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const win = await app.browserWindow(studio)
    await expect.poll(() => win.evaluate(window => window.isVisible())).toBe(true)
    const toolbar = studio.locator('.theme-studio header')
    const base = toolbar.getByRole('combobox')
    const documentMode = toolbar.getByRole('button', { name: '正文', exact: true })
    const sourceMode = toolbar.getByRole('button', { name: 'Markdown 源码', exact: true })
    const preview = studio.frameLocator('iframe')
    const previewModes = toolbar.getByRole('group', { name: '主题预览', exact: true })
    await expect(base).toHaveValue('nord')
    for (const control of [documentMode, sourceMode]) await expect(control).toBeVisible()
    await expect(studio.getByRole('button', { name: '预览本地 Markdown', exact: true })).toHaveCount(0)
    await expect(studio.locator('input[type=file][accept*=".markdown"]')).toHaveCount(0)
    const horizontalCenter = (control: Locator) => control.evaluate(element => {
      const { x, width } = element.getBoundingClientRect()
      return x + width / 2
    })
    for (const width of [1160, 700]) {
      await win.evaluate((window, width) => window.setSize(width, 700), width)
      await expect.poll(async() => Math.abs(await horizontalCenter(toolbar) - await horizontalCenter(previewModes))).toBeLessThan(2)
    }
    await expect(preview.locator('h1')).toContainText('雾岭手记')
    await expect(preview.locator('h6')).toContainText('记录约定')
    await expect(preview.locator('.mu-table-row')).toHaveCount(4)
    await expect(preview.locator('.mu-task-list-item')).toHaveCount(3)
    await expect(preview.locator('.mu-github-alert')).toHaveCount(1)
    await expect(preview.locator('.mu-math-block')).toHaveCount(1)
    await expect(preview.locator('.mu-footnote')).toHaveCount(1)
    await sourceMode.click()
    await expect(preview.locator('.CodeMirror-line').first()).toContainText('# 雾岭手记')
    await documentMode.click()
    await expect(preview.locator('h1')).toContainText('雾岭手记')
    await (await app.browserWindow(page)).evaluate(window => window.focus())
    await clickMenuById(app, 'createThemeFromCurrent')
    expect(app.windows().filter(window => window.url().includes('theme-studio.html'))).toHaveLength(1)
  } finally { await app.close() }
})

test('the CSS inspector docks beside the studio and selects live preview HTML', async() => {
  const { app, page } = await launchWithMarkdown('## Editor document', {
    preferences: { language: 'en', theme: 'light', followSystemTheme: false }
  })
  try {
    const settings = await openSettings(app, page)
    const studio = await openStudio(app, settings)
    const native = await app.browserWindow(studio)
    const input = studio.getByRole('textbox', { name: 'CSS source' })
    await input.focus()
    await studio.keyboard.insertText(layout)
    const width = await studio.evaluate(() => innerWidth)
    const inspector = studio.getByRole('button', { name: 'Inspect element', exact: true })
    await inspector.click()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => studio.evaluate(() => innerWidth)).toBeLessThan(width)
    const panels = await studio.locator('main > section').evaluateAll(items =>
      items.map(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })))
    expect(panels[1].top).toBeGreaterThanOrEqual(panels[0].bottom - 1)
    const preview = studio.frameLocator('iframe')
    await preview.locator('h2').click({ position: { x: 2, y: 2 } })

    // DevTools exposes the selected HTML row through the accessible tree inside its shadow roots.
    function selectedTreeRows(): string[] {
      const rows: string[] = []
      function visit(root: Document | ShadowRoot): void {
        for (const item of root.querySelectorAll('[role="treeitem"][aria-selected="true"]')) {
          rows.push(item.textContent ?? '')
        }
        for (const item of root.querySelectorAll('*')) {
          if (item.shadowRoot) visit(item.shadowRoot)
        }
      }
      visit(document)
      return rows
    }
    const selection = '(' + selectedTreeRows.toString() + ')()'
    const readSelected = () => native.evaluate((win, script) =>
      win.webContents.devToolsWebContents?.executeJavaScript(script), selection)
    await expect.poll(readSelected).toEqual(expect.arrayContaining([expect.stringContaining('mu-atx-heading')]))

    const assertPointSelection = async(element: Locator, marker: string): Promise<void> => {
      await element.evaluate((_el, value) => {
        window.addEventListener('pointerdown', event => {
          if (event.target instanceof Element) event.target.setAttribute('data-inspector-hit', value)
        }, { capture: true, once: true })
      }, marker)
      await element.click({ position: { x: 2, y: 2 } })
      await expect.poll(readSelected).toEqual(expect.arrayContaining([expect.stringContaining(marker)]))
    }
    await native.evaluate(win => win.webContents.setZoomFactor(1.25))
    await assertPointSelection(preview.locator('h1'), 'zoomed-heading')
    await studio.getByRole('button', { name: 'Markdown source', exact: true }).click()
    await assertPointSelection(preview.locator('.CodeMirror-line').first(), 'markdown-source-line')
    await native.evaluate(win => win.webContents.setZoomFactor(1))
    await native.evaluate(win => win.webContents.closeDevTools())
    await expect(inspector).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => studio.evaluate(() => innerWidth)).toBe(width)
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(layout)
    await inspector.click()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await studio.reload()
    await expect(inspector).toHaveAttribute('aria-pressed', 'true')
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(layout)
    await inspector.click()
    await expect.poll(() => native.evaluate(win => win.webContents.isDevToolsOpened())).toBe(false)
    await expect(settings.evaluate(async() => {
      try { await window.electron.ipcRenderer.invoke('mt::theme::set-inspector', true); return 'opened' }
      catch { return 'denied' }
    })).resolves.toBe('denied')
  } finally { await app.close() }
})

test('Elements tree selections add or focus a rule in the writable theme CSS', async() => {
  const { app, page } = await launchWithMarkdown('Document', { preferences: { language: 'en', theme: 'light' } })
  try {
    const studio = await openStudio(app, await openSettings(app, page))
    const native = await app.browserWindow(studio)
    const input = studio.getByRole('textbox', { name: 'CSS source' })
    await input.focus()
    await studio.keyboard.insertText(layout)
    const preview = studio.frameLocator('iframe')
    // Wait for the preview to re-render with the inserted CSS before inspecting:
    // the inspector maps the click position into the live iframe DOM.
    await expect(preview.locator('h2')).toHaveCSS('margin-top', '47px')
    await studio.getByRole('button', { name: 'Inspect element' }).click()
    const selector = studio.getByRole('combobox', { name: 'Selector', exact: true })
    await expect(studio.locator('main.inspecting')).toBeVisible()
    await preview.locator('h2').click({ position: { x: 2, y: 2 } })
    await expect(selector).toHaveValue('.mu-atx-heading')
    const locate = studio.getByRole('button', { name: 'Go to rule' })
    await locate.click()
    await expect(input).toBeFocused()
    await studio.keyboard.insertText('padding: 12px; ')
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(layout.replace('margin-top', 'padding: 12px; margin-top'))

    function paragraphInTree(): { x: number; y: number } | null {
      const roots: Array<Document | ShadowRoot> = [document]
      for (const root of roots) {
        for (const row of root.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
          const label = row.textContent?.replaceAll('\u200b', '').trim() ?? ''
          if (!/^<p\b[^>]*\bmu-paragraph\b/.test(label)) continue
          const tag = row.querySelector('.webkit-html-tag-name') ?? row
          tag.scrollIntoView({ block: 'nearest' })
          const bounds = tag.getBoundingClientRect()
          if (bounds.width && bounds.height) return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        }
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot) roots.push(element.shadowRoot)
        }
      }
      return null
    }
    const selectParagraph = async() => native.evaluate(async(win, script) => {
      const tools = win.webContents.devToolsWebContents
      if (!tools) return false
      const point = await tools.executeJavaScript(script)
      if (!point) return false
      const x = Math.round(point.x * tools.getZoomFactor())
      const y = Math.round(point.y * tools.getZoomFactor())
      tools.focus()
      tools.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      tools.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      return true
    }, '(' + paragraphInTree.toString() + ')()')
    await expect.poll(selectParagraph).toBe(true)
    await expect(selector).toHaveValue('.mu-paragraph')
    const base = studio.getByRole('checkbox', { name: 'View base CSS (read-only)' })
    await base.check()
    const add = studio.getByRole('button', { name: 'Add selector' })
    await add.click()
    await expect(base).not.toBeChecked()
    await expect(input).toBeFocused()
    await studio.keyboard.insertText('letter-spacing: 1.5px;')
    await expect(preview.locator('p.mu-paragraph').first()).toHaveCSS('letter-spacing', '1.5px')
    await locate.click()
    const lines = studio.locator('.css-source .CodeMirror-line')
    await expect(lines.filter({ hasText: '.mu-paragraph {' })).toHaveCount(1)
    await expect(lines.filter({ hasText: 'letter-spacing: 1.5px;' })).toHaveCount(1)
  } finally { await app.close() }
})

test('previously saved themes open as editable CSS and retain their ID', async() => {
  const id = 'local:light:bc583c7e-a40d-4828-9d4f-fe48935dfe88'
  const { app, page } = await launchWithMarkdown('## Sample', {
    preferences: { language: 'en', theme: id, followSystemTheme: false,
      localThemes: [{ version: 1, id, name: 'Older theme', base: 'light', values: { h2: '#126789' } }] }
  })
  try {
    const settings = await openSettings(app, page)
    const studio = await openStudio(app, settings, true)
    const preview = studio.frameLocator('iframe')
    await expect(preview.locator('h2')).toHaveCSS('color', 'rgb(18, 103, 137)')
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText('#126789')
    const base = studio.getByRole('checkbox', { name: 'View base CSS (read-only)' })
    await base.check()
    await expect(studio.locator('.css-source .CodeMirror-code')).toContainText(':root')
    await base.uncheck()
    await studio.getByRole('button', { name: 'Save options' }).click()
    await studio.getByRole('button', { name: 'Save and apply' }).click()
    await expect(studio.getByRole('button', { name: 'Save theme only' })).toBeDisabled()
    const prefs = await settings.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(prefs.localThemes).toHaveLength(1)
    expect(prefs.localThemes?.[0]).toMatchObject({ id, values: {}, css: expect.stringContaining('#126789') })
    await expect(page.locator('.mu-container h2')).toHaveCSS('color', 'rgb(18, 103, 137)')
  } finally { await app.close() }
})

test('saving an active theme creates a copy that can be applied separately', async() => {
  const id = 'local:light:bc583c7e-a40d-4828-9d4f-fe48935dfe88'
  const original = { version: 1, id, name: 'Cedar', base: 'light', values: {}, css: '' }
  const { app, page } = await launchWithMarkdown('## Editor document', {
    preferences: { language: 'en', theme: id, lightModeTheme: id, followSystemTheme: false, localThemes: [original] }
  })
  try {
    const settings = await openSettings(app, page)
    const studio = await openStudio(app, settings, true)
    await studio.getByRole('textbox', { name: 'CSS source' }).focus()
    await studio.keyboard.insertText(layout)
    await expect(studio.frameLocator('iframe').locator('h2')).toHaveCSS('margin-top', '47px')
    await studio.getByRole('button', { name: 'Save theme only' }).click()
    await expect(studio.getByLabel('Theme name')).toHaveValue('Cedar (2)')

    const getPreferences = () => settings.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    const saved = await getPreferences()
    expect(saved.theme).toBe(id)
    expect(saved.lightModeTheme).toBe(id)
    expect(saved.localThemes).toEqual([original, expect.objectContaining({ name: 'Cedar (2)', css: layout })])
    const copyId = saved.localThemes?.find(theme => theme.name === 'Cedar (2)')?.id
    expect(copyId).toBeTruthy()
    expect(copyId).not.toBe(id)
    const heading = page.locator('.mu-container h2')
    await expect(heading).not.toHaveCSS('margin-top', '47px')

    const options = studio.getByRole('button', { name: 'Save options' })
    const apply = studio.getByRole('button', { name: 'Save and apply' })
    await options.press('Enter')
    await expect(apply).toBeFocused()
    await studio.keyboard.press('Escape')
    await expect(apply).toBeHidden()
    await expect(options).toBeFocused()
    await options.press('Enter')
    await apply.press('Enter')
    await expect(heading).toHaveCSS('margin-top', '47px')
    const applied = await getPreferences()
    expect(applied.theme).toBe(copyId)
    expect(applied.localThemes).toHaveLength(2)
  } finally { await app.close() }
})
