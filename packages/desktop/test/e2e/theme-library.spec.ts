import { expect, test } from '@playwright/test'
import { clickMenuById, launchWithMarkdown } from './helpers'

test('the theme library deletes drafts and applied themes across a reload', async() => {
  const id = 'local:light:ad36974a-7253-4c54-8550-d22af67de076'
  const { app, page } = await launchWithMarkdown('Document', {
    preferences: {
      language: 'en', theme: id, followSystemTheme: false, lightModeTheme: id,
      localThemes: [{ version: 1, id, name: 'Saved theme', base: 'light', values: {}, css: '' }]
    }
  })
  try {
    const opened = app.waitForEvent('window')
    await clickMenuById(app, 'createThemeFromCurrent')
    const studio = await opened
    const name = studio.locator('.studio-toolbar').getByLabel('Theme name')
    const library = studio.getByRole('dialog', { name: 'Theme library', exact: true })
    const openLibrary = () => studio.getByRole('button', { name: 'Theme library', exact: true }).click()
    const deleteDraft = library.getByRole('button', { name: 'Delete draft · Disposable draft', exact: true })

    await name.fill('Disposable draft')
    await openLibrary()
    await library.locator('.theme-row[title="Saved theme"]').click()
    await expect(name).toHaveValue('Saved theme')

    await openLibrary()
    await deleteDraft.click()
    const cancel = library.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancel).toBeFocused()
    await cancel.click()
    await expect(deleteDraft).toBeFocused()
    await deleteDraft.click()
    await library.getByRole('button', { name: 'Delete draft', exact: true }).click()
    await expect(name).toHaveValue('Saved theme')

    await openLibrary()
    await expect(deleteDraft).toHaveCount(0)
    await library.getByRole('button', { name: 'Delete theme · Saved theme', exact: true }).click()
    await expect(library.getByText(/switch to this theme’s built-in base theme/)).toBeVisible()
    await library.getByRole('button', { name: 'Delete theme', exact: true }).click()
    await expect(name).toHaveValue('My new theme')
    const prefs = await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::preferences::get'))
    expect(prefs).toMatchObject({ theme: 'light', lightModeTheme: 'light', localThemes: [] })

    await studio.reload()
    await openLibrary()
    await expect(library.getByText('No drafts or saved themes yet.')).toBeVisible()
  } finally {
    await app.close()
  }
})
