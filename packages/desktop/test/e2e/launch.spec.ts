import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchElectron } from './helpers'

test.describe('Check Launch AutumnMark+', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const { app: electronApp, page: firstPage } = await launchElectron()
    app = electronApp
    page = firstPage
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('Empty AutumnMark+', async() => {
    await expect(page).toHaveTitle('Untitled-1 - AutumnMark+')
  })

  test('uses the new native application name', async() => {
    expect(await app.evaluate(({ app }) => app.getName())).toBe('AutumnMark+')
  })
})
