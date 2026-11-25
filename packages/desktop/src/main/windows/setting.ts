import { BrowserWindow, ipcMain } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { electronLocalshortcut } from 'common/localShortcut'
import BaseWindow, { WindowLifecycle, WindowType } from './base'
import type Accessor from '../app/accessor'
import { centerWindowOptions } from './utils'
import { TITLE_BAR_HEIGHT, preferencesWinOptions, isOsx } from '../config'
import log from 'electron-log'

class SettingWindow extends BaseWindow {
  private pendingCategory?: string

  constructor(accessor: Accessor) {
    super(accessor)
    this.type = WindowType.SETTINGS
  }

  createWindow(category: string | null = null): BrowserWindow {
    const { env, keybindings, preferences } = this._accessor
    const winOptions: BrowserWindowConstructorOptions = { ...preferencesWinOptions }
    centerWindowOptions(
      winOptions as BrowserWindowConstructorOptions & {
        width: number
        height: number
        x?: number
        y?: number
      }
    )
    // WORKAROUND: Electron has issues with different DPI per monitor when
    // setting a fixed window size.
    winOptions.resizable = true

    const initialPreferences = preferences.getAll()
    const { titleBarStyle, theme } = initialPreferences
    if (!isOsx) {
      winOptions.titleBarStyle = 'default'
      if (titleBarStyle === 'native') {
        winOptions.frame = true
      }
    }

    winOptions.backgroundColor = this._getPreferredBackgroundColor(theme, initialPreferences.localThemes)
    const win = (this.browserWindow = new BrowserWindow(winOptions))

    win.webContents.on('did-fail-load', (_event, code, desc, url) => {
      log.error(`did-fail-load ${code} ${desc} @ ${url}`)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`render-process-gone: ${details.reason} (${details.exitCode})`)
    })

    this.id = win.id

    win.webContents.on('did-navigate', () => {
      this.lifecycle = WindowLifecycle.LOADING
    })
    win.webContents.ipc.on('mt::settings-ready', () => {
      this.lifecycle = WindowLifecycle.READY
      if (this.pendingCategory) {
        win.webContents.send('settings::change-tab', this.pendingCategory)
        this.pendingCategory = undefined
      }
      this.emit('window-ready')
    })

    const onFocus = (): void => {
      this.emit('window-focus')
      win.webContents.send('mt::window-active-status', { status: true })
    }

    const onBlur = (): void => {
      this.emit('window-blur')
      win.webContents.send('mt::window-active-status', { status: false })
    }
    win.on('focus', onFocus)
    win.on('blur', onBlur)
    // macOS can deliver focus/blur after closed; these listeners own a live renderer only.
    win.once('closed', () => {
      win.removeListener('focus', onFocus)
      win.removeListener('blur', onBlur)
    })

    win.on('closed', () => {
      this.emit('window-closed')

      this.browserWindow = null
    })

    this.lifecycle = WindowLifecycle.LOADING
    const url = this._buildUrlWithSettings(this.id, env, initialPreferences)
    if (category) url.searchParams.set('type', `${WindowType.SETTINGS}/${category}`)
    void win.loadURL(url.toString()).catch(error => {
      if (!win.isDestroyed()) log.error(error)
    })
    win.setSheetOffset(TITLE_BAR_HEIGHT)

    const devToolsAccelerator = keybindings.getAccelerator('view.toggle-dev-tools')
    if (env.debug && devToolsAccelerator) {
      electronLocalshortcut.register(win, devToolsAccelerator, () => {
        win.webContents.toggleDevTools()
      })
    }
    return win
  }

  open(): void {
    const win = this.browserWindow
    if (!win) return
    this._accessor.menu.addSettingMenu(win)
    this._accessor.windowManager.add(this)
    win.on('close', event => {
      this.emit('window-close')
      event.preventDefault()
      ipcMain.emit('window-close-by-id', win.id)
    })
    win.show()
  }

  selectCategory(category: string): void {
    if (this.lifecycle === WindowLifecycle.READY) {
      this.browserWindow?.webContents.send('settings::change-tab', category)
    } else {
      this.pendingCategory = category
    }
  }

}

export default SettingWindow
