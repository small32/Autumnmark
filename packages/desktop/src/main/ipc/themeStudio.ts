import { randomUUID } from 'node:crypto'
import { dialog, ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log'
import { isLocalTheme, localThemeList, maxThemeNameLength, themeBases, themeSelectionPatch } from '@shared/localTheme'
import type Accessor from '../app/accessor'
import { WindowLifecycle, WindowType, type WindowTypeValue } from '../windows/base'
import { t } from '../i18n'
import { onInternalChannel } from '../utils/internalIpc'
import ThemeStudioWindow, { loadThemeInspector } from '../windows/themeStudio'
import { registerThemeCollaboration } from './themeCollaboration'
import { requireModelWindow } from './windowAuth'

export const registerThemeStudio = (app: Accessor): void => {
  registerThemeCollaboration(app)
  let openingStudio: Promise<void> | undefined
  const authorize = (event: IpcMainInvokeEvent, type: WindowTypeValue = WindowType.STUDIO): void =>
    requireModelWindow(app, event, type)

  const openStudio = async(id: string, editing: boolean): Promise<void> => {
    const library = localThemeList(app.preferences.getAll().localThemes)
    const local = library.find(item => item.id === id)
    if (typeof editing !== 'boolean' || (!local && (editing || !themeBases.includes(id)))) throw new Error('invalidRequest')
    if (openingStudio) await openingStudio
    for (const { win } of app.windowManager.getWindowsByType(WindowType.STUDIO)) {
      if (win instanceof ThemeStudioWindow && win.lifecycle === WindowLifecycle.READY) {
        win.browserWindow?.webContents.send('mt::theme::show', id, editing)
        win.bringToFront()
        return
      }
    }
    const studio = new ThemeStudioWindow(app, id, editing)
    openingStudio = studio.open()
    try { await openingStudio }
    finally { openingStudio = undefined }
  }
  onInternalChannel('create-theme-from-current', () => {
    void openStudio(app.preferences.getAll().theme, false).catch(error => {
      log.error('Opening the theme editor failed', error)
      dialog.showErrorBox(t('studio.title'), t('studio.openFailed'))
    })
  })
  ipcMain.handle('mt::theme::open', (event, id: string, editing: boolean) => {
    authorize(event, WindowType.SETTINGS)
    return openStudio(id, editing)
  })
  ipcMain.handle('mt::theme::inspector-state', event => {
    authorize(event)
    return event.sender.isDevToolsOpened()
  })
  ipcMain.handle('mt::theme::set-inspector', async(event, open: boolean) => {
    authorize(event)
    const { sender } = event
    if (typeof open !== 'boolean') throw new Error('invalidRequest')
    const wasOpen = sender.isDevToolsOpened()
    if (open && !wasOpen) {
      await loadThemeInspector(sender.session)
      if (!sender.isDestroyed()) sender.openDevTools({ mode: 'right', activate: false })
    }
    if (!open && wasOpen) sender.closeDevTools()
  })
  ipcMain.handle('mt::theme::inspect-element', (event, x: number, y: number) => {
    authorize(event)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error('invalidRequest')
    const { sender } = event
    if (sender.isDevToolsOpened()) {
      const zoom = sender.getZoomFactor()
      sender.inspectElement(Math.round(x * zoom), Math.round(y * zoom))
    }
  })
  ipcMain.handle('mt::theme::save', (event, input: unknown, apply: unknown) => {
    authorize(event)
    if (!isLocalTheme(input) || typeof apply !== 'boolean') throw new Error('invalidRequest')
    const { version, base, values, css } = input
    let { id, name } = input
    name = name.trim()
    const prefs = app.preferences.getAll()
    const themes = localThemeList(prefs.localThemes)
    const downloaded = themes.some(theme => theme.id === id && theme.catalog)
    if (downloaded || (!apply && [prefs.theme, prefs.lightModeTheme, prefs.darkModeTheme].includes(id))) {
      id = `local:${base}:${randomUUID()}`
      const existingNames = new Set(themes.map(theme => theme.name))
      const originalName = name
      for (let number = 2; existingNames.has(name); number++) {
        const suffix = ` (${number})`
        const stem = originalName.slice(0, maxThemeNameLength - suffix.length).replace(/\p{Surrogate}$/u, '').trimEnd()
        name = stem + suffix
      }
    }
    const theme = { version, id, name, base, values, css }
    const library = themes.filter(item => item.id !== id)
    library.push(theme)
    const result = app.preferences.update({ localThemes: library, ...(apply ? themeSelectionPatch(prefs, id, nativeTheme.shouldUseDarkColors) : {}) })
    return result.status === 'persisted' ? theme : null
  })
  ipcMain.handle('mt::theme::delete', (event, id: string) => {
    requireModelWindow(app, event, WindowType.STUDIO, WindowType.SETTINGS)
    const prefs = app.preferences.getAll()
    const library = prefs.localThemes ?? []
    const theme = localThemeList(library).find(item => item.id === id)
    if (!theme) return prefs
    const result = app.preferences.update({
      localThemes: library.filter(item => item?.id !== id),
      ...(prefs.theme === id ? { theme: theme.base } : {}),
      ...(prefs.lightModeTheme === id ? { lightModeTheme: theme.base } : {}),
      ...(prefs.darkModeTheme === id ? { darkModeTheme: theme.base } : {})
    })
    if (result.status !== 'persisted') return null
    const next = app.preferences.getAll()
    for (const { win } of app.windowManager.getWindowsByType(WindowType.STUDIO)) {
      const contents = win.browserWindow?.webContents
      if (contents !== event.sender) contents?.send('mt::preferences::changed', next)
    }
    return next
  })
}
