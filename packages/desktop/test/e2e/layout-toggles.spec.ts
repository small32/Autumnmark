import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as path from 'node:path'
import { launchWithMarkdown, clickMenuById, openProjectFolder, sendIpcToRenderer } from './helpers'

// Wait until a `v-show`-toggled element's visibility differs from `wasVisible`.
// A missing element counts as "not visible", so the change-detection logic
// stays consistent whether v-show clears the inline style or unmounts the node.
const waitForVisibilityFlip = (page: Page, selector: string, wasVisible: boolean) =>
  page.waitForFunction(
    ({ sel, prior }) => {
      const el = document.querySelector(sel) as HTMLElement | null
      const visible = !!(el && el.style.display !== 'none' && el.offsetParent !== null)
      return visible !== prior
    },
    { sel: selector, prior: wasVisible },
    { timeout: 5000 }
  )

test.describe('Layout panel toggles', () => {
  let app: ElectronApplication
  let page: Page
  let filePath: string

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Layout\n\n## Section A\n\n## Section B\n')
    app = launched.app
    page = launched.page
    filePath = launched.filePath
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('the sidebar and editor tabs start below the full-width title bar', async() => {
    await sendIpcToRenderer(app, 'mt::set-view-layout', { showSideBar: true, showTabBar: true })

    const sideBar = page.locator('.side-bar')
    const fileToolbar = sideBar.locator('.sidebar-header')
    const tabBar = page.locator('.editor-tabs')
    await expect(fileToolbar).toBeVisible()
    await expect(tabBar).toBeVisible()

    const [title, side, files, tabs] = await Promise.all(
      [page.locator('.title-bar'), sideBar, fileToolbar, tabBar].map((locator) =>
        locator.evaluate((element) => {
          const { top, bottom, left, right } = element.getBoundingClientRect()
          return { top, bottom, left, right }
        })
      )
    )
    expect(title.left).toBe(0)
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(Math.abs(title.right - viewportWidth)).toBeLessThanOrEqual(1)
    expect(side.top).toBe(title.bottom)
    expect(files.top).toBe(tabs.top)
    expect(files.bottom).toBe(tabs.bottom)
    expect(side.right).toBe(tabs.left)
  })

  test('Sidebar toggle changes .side-bar visibility', async() => {
    const sideBar = page.locator('.side-bar')
    const initial = await sideBar.isVisible()
    await clickMenuById(app, 'sideBarMenuItem')
    await waitForVisibilityFlip(page, '.side-bar', initial)
    const afterToggle = await sideBar.isVisible()
    expect(afterToggle).not.toBe(initial)
    await clickMenuById(app, 'sideBarMenuItem')
  })

  test('Tab bar toggle flips .editor-tabs visibility', async() => {
    const tabBar = page.locator('.editor-tabs')
    const initial = await tabBar.isVisible()
    await clickMenuById(app, 'tabBarMenuItem')
    await waitForVisibilityFlip(page, '.editor-tabs', initial)
    const afterToggle = await tabBar.isVisible()
    expect(afterToggle).not.toBe(initial)
    await clickMenuById(app, 'tabBarMenuItem')
  })

  test('TOC menu toggles ToC panel without throwing', async() => {
    const sideBar = page.locator('.side-bar')
    if (!(await sideBar.isVisible())) {
      await clickMenuById(app, 'sideBarMenuItem')
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.side-bar') as HTMLElement | null
          return el && el.offsetParent !== null
        },
        null,
        { timeout: 5000 }
      )
    }
    await clickMenuById(app, 'tocMenuItem')
    await expect(page.locator('#sidebar-panel-outline')).toBeVisible()
    await page.waitForTimeout(200)
    await clickMenuById(app, 'tocMenuItem')
  })

  test('sidebar tabs keep equal widths and keyboard navigation at narrow widths', async() => {
    const tabList = page.locator('.sidebar-tabs')
    const tabs = tabList.getByRole('tab')
    const files = tabList.locator('#sidebar-tab-files')
    const outline = tabList.locator('#sidebar-tab-outline')
    const ai = tabList.locator('#sidebar-tab-documentChat')
    const tabWidths = () => tabs.evaluateAll(elements =>
      elements.map(element => element.getBoundingClientRect().width)
    )

    await sendIpcToRenderer(app, 'mt::set-view-layout', { showSideBar: true, sideBarWidth: 280 })
    await expect(tabs).toHaveCount(3)
    await files.click()
    await expect(files.locator('.sidebar-tab-icon')).toBeVisible()
    const widths = await tabWidths()
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1)

    await files.press('ArrowRight')
    await expect(outline).toBeFocused()
    await expect(outline).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#sidebar-panel-outline .outline-bulk-toggle')).toBeVisible()
    expect(await tabWidths()).toEqual(widths)

    await sendIpcToRenderer(app, 'mt::set-view-layout', { sideBarWidth: 220 })
    await expect(outline.locator('.sidebar-tab-icon')).toBeHidden()
    await outline.press('End')
    await expect(ai).toBeFocused()
    await expect(ai).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#sidebar-panel-documentChat')).toBeVisible()
    await ai.press('Home')
    await expect(files).toBeFocused()
    await expect(files).toHaveAttribute('aria-selected', 'true')
    await sendIpcToRenderer(app, 'mt::set-view-layout', { sideBarWidth: 280 })
  })

  test('Search returns to files with the back button and Escape', async() => {
    const sideBar = page.locator('.side-bar')
    if (!(await sideBar.isVisible())) await clickMenuById(app, 'sideBarMenuItem')
    const searchButton = sideBar.locator('#sidebar-panel-files .search-button')
    const input = sideBar.locator('.search-input')
    const width = await sideBar.evaluate(el => el.getBoundingClientRect().width)

    await expect(sideBar.locator('.left-column')).toHaveCount(0)
    const tabBarTop = await sideBar.locator('.sidebar-header').evaluate(el => el.getBoundingClientRect().top)
    await searchButton.click()
    await expect(input).toBeFocused()
    const searchHeaderTop = await sideBar.locator('.search-header').evaluate(el => el.getBoundingClientRect().top)
    expect(Math.abs(searchHeaderTop - tabBarTop)).toBeLessThanOrEqual(1)
    await expect(sideBar.locator('.controls button')).toHaveCount(3)
    await expect(sideBar.locator('.settings-button')).toBeVisible()
    expect(await sideBar.evaluate(el => el.getBoundingClientRect().width)).toBe(width)

    await input.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
    await expect(input).toBeVisible()
    await input.dispatchEvent('keydown', { key: 'Escape', keyCode: 229 })
    await expect(input).toBeVisible()
    await input.press('Escape')
    await expect(sideBar.locator('.tree-view')).toBeVisible()
    await expect(searchButton).not.toBeFocused()

    await searchButton.click()
    await sideBar.locator('.back-button').click()
    await expect(searchButton).toBeFocused()
    expect(await sideBar.evaluate(el => el.getBoundingClientRect().width)).toBe(width)
  })

  test('Existing folder search and result navigation still work at minimum width', async() => {
    await openProjectFolder(app, page, path.dirname(filePath), filePath)
    await sendIpcToRenderer(app, 'mt::set-view-layout', { sideBarWidth: 220 })
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findInFolder')
    const sideBar = page.locator('.side-bar')
    const input = sideBar.locator('.search-input')
    await expect(input).toBeFocused()
    await input.fill('Section')
    await input.press('Enter')
    await expect(sideBar.locator('.search-result-item')).toHaveCount(1)
    await expect(sideBar.locator('.search-result-item .matches li')).toHaveCount(2)
    await sideBar.locator('.search-result-item .matches li').first().click()
    await expect(input).toBeVisible()
    await expect(sideBar.locator('.settings-button')).toBeVisible()

    const inputBox = await input.evaluate(el => el.getBoundingClientRect().toJSON())
    const controlsBox = await sideBar.locator('.controls').evaluate(el => el.getBoundingClientRect().toJSON())
    expect(inputBox.width).toBeGreaterThan(50)
    expect(controlsBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 1)
    await sideBar.locator('.back-button').click()
  })

  test('Editor fills width after hiding the sidebar', async() => {
    const sideBar = page.locator('.side-bar')
    if (await sideBar.isVisible()) await clickMenuById(app, 'sideBarMenuItem')
    await expect(sideBar).toBeHidden()
    await expect.poll(async() => page.evaluate(() => {
      const editor = document.querySelector('.editor-with-tabs')
      if (!editor) throw new Error('Editor is not mounted')
      return Math.abs(editor.getBoundingClientRect().width - window.innerWidth)
    })).toBeLessThanOrEqual(1)
    await clickMenuById(app, 'sideBarMenuItem')
    await expect(sideBar).toBeVisible()
  })
})
