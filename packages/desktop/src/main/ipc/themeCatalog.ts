import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ipcMain, nativeTheme, net } from 'electron'
import { isCatalogThemeId, localThemeList, themeSelectionPatch, type LocalTheme } from '@shared/localTheme'
import type Accessor from '../app/accessor'
import { WindowType } from '../windows/base'
import { requireModelWindow } from './windowAuth'
import { ThemeCatalogDownload } from './themeCatalogDownload'

export const registerThemeCatalog = (app: Accessor): void => {
  const catalog = new ThemeCatalogDownload(
    path.join(app.paths.userDataPath, 'theme-catalog-autumnmark-theme.json'),
    MARKTEXT_VERSION,
    (url, options) => net.fetch(url, options)
  )

  ipcMain.handle('mt::theme::catalog', (event, refresh: unknown) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    return catalog.list(refresh === true)
  })

  const findRelease = async(id: unknown, revision: unknown) => {
    if (!isCatalogThemeId(id)) throw new Error('Invalid theme request')
    const snapshot = await catalog.list(false)
    const entry = snapshot.themes.find(item => item.id === id && item.revision === revision && item.compatible)
    if (!entry) throw new Error('Theme version unavailable')
    return entry
  }

  ipcMain.handle('mt::theme::preview', async(event, id: unknown, revision: unknown) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    const entry = await findRelease(id, revision)
    return catalog.download(entry)
  })

  ipcMain.handle('mt::theme::install', async(event, id: unknown, revision: unknown, apply: unknown) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    if (typeof apply !== 'boolean') throw new Error('Invalid theme request')
    const entry = await findRelease(id, revision)
    const installedBeforeDownload = localThemeList(app.preferences.getAll().localThemes)
      .find(item => item.catalog?.id === entry.id)
    const downloaded = (installedBeforeDownload?.catalog?.revision ?? 0) < entry.revision
      ? await catalog.download(entry)
      : undefined

    // Re-read after the download because another request or Studio may have saved themes meanwhile.
    const prefs = app.preferences.getAll()
    const library = localThemeList(prefs.localThemes)
    const existing = library.find(item => item.catalog?.id === entry.id)
    if (existing && existing.base !== entry.base) throw new Error('Theme base changed')
    const replacement: LocalTheme | undefined = downloaded && (existing?.catalog?.revision ?? 0) < entry.revision
      ? {
        version: downloaded.version,
        id: existing?.id ?? `local:${entry.base}:${randomUUID()}`,
        name: entry.name,
        base: entry.base,
        values: downloaded.values,
        css: downloaded.css,
        catalog: { id: entry.id, revision: entry.revision }
      }
      : undefined
    const theme = replacement ?? existing
    if (!theme) throw new Error('Theme version unavailable')
    if (replacement || apply) {
      const result = app.preferences.update({
        ...(replacement ? { localThemes: [...library.filter(item => item.id !== theme.id), theme] } : {}),
        ...(apply ? themeSelectionPatch(prefs, theme.id, nativeTheme.shouldUseDarkColors) : {})
      })
      if (result.status !== 'persisted') return null
    }
    return app.preferences.getAll()
  })
}
