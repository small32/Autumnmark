import {
  BrowserWindow,
  Menu,
  MenuItem,
  ipcMain,
  screen,
  type WebContents
} from 'electron'
import log from 'electron-log'
import type { IpcInvokeChannels } from '@shared/types/ipc'
import type { MenuTemplate, MenuTemplateItem, MenuPopupPosition, ContextMenuPopupOptions } from '@shared/types/menu'
import { buildEditorContextMenu } from '../contextMenu/editor'

const windowFromEvent = ({ sender }: { sender: WebContents }): BrowserWindow | null =>
  BrowserWindow.fromWebContents(sender)

interface PopupEntry {
  sender: WebContents
}
const popups = new Map<number, PopupEntry>()

const buildMenu = (template: MenuTemplate | undefined, windowId: number, menu = new Menu()): Menu => {
  for (const item of template || []) {
    if (item.type === 'separator') {
      menu.append(new MenuItem({ type: 'separator' }))
      continue
    }
    const id = item.id
    menu.append(
      new MenuItem({
        label: item.label,
        type: item.type as 'normal' | 'submenu' | 'checkbox' | 'radio' | undefined,
        accelerator: item.accelerator,
        enabled: item.enabled !== false,
        checked: !!item.checked,
        click: () => {
          const sender = popups.get(windowId)?.sender
          try {
            sender?.send('mt::menu::click', { windowId, id })
          } catch {
            /* sender destroyed */
          }
        },
        submenu: item.submenu ? buildMenu(item.submenu as MenuTemplateItem[], windowId) : undefined
      })
    )
  }
  return menu
}

export const registerWindowHandlers = (): void => {
  ipcMain.on('mt::win::minimize', (event) => {
    const win = windowFromEvent(event)
    if (win) win.minimize()
  })
  ipcMain.on('mt::win::toggle-maximize', (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('mt::win::maximize', (event) => {
    const win = windowFromEvent(event)
    if (win) win.maximize()
  })
  ipcMain.on('mt::win::unmaximize', (event) => {
    const win = windowFromEvent(event)
    if (win) win.unmaximize()
  })
  ipcMain.on('mt::win::close', (event) => {
    const win = windowFromEvent(event)
    if (win) win.close()
  })
  ipcMain.on('mt::win::set-fullscreen', (event, flag: boolean) => {
    const win = windowFromEvent(event)
    if (win) win.setFullScreen(!!flag)
  })
  ipcMain.on('mt::win::toggle-fullscreen', (event) => {
    const win = windowFromEvent(event)
    if (win) win.setFullScreen(!win.isFullScreen())
  })
  ipcMain.handle('mt::win::is-maximized', (event) => {
    const win = windowFromEvent(event)
    return !!win && win.isMaximized()
  })
  ipcMain.handle('mt::win::is-fullscreen', (event) => {
    const win = windowFromEvent(event)
    return !!win && win.isFullScreen()
  })
  ipcMain.handle(
    'mt::win::is-cursor-over',
    (event, bounds: IpcInvokeChannels['mt::win::is-cursor-over']['args'][0]) => {
      const win = windowFromEvent(event)
      if (!win?.isFocused()) return false

      const cursor = screen.getCursorScreenPoint()

      const content = win.getContentBounds()
      const zoom = event.sender.getZoomFactor()
      const x = (cursor.x - content.x) / zoom
      const y = (cursor.y - content.y) / zoom
      return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom
    }
  )

  ipcMain.on('mt::menu::popup', (event, template: MenuTemplate, options?: ContextMenuPopupOptions) => {
    const win = windowFromEvent(event)
    if (!win) return
    // Stash sender BEFORE menu.popup so buildMenu click handlers can resolve
    // it, but make sure we still clean up the map entry if menu.popup throws
    // — otherwise the entry leaks and a later popup for the same window could
    // route clicks to a dead sender.
    popups.set(win.id, { sender: event.sender })
    try {
      const editor = options?.editor
      const prefix = editor ? buildEditorContextMenu(editor.selectionText, editor.spellcheckerEnabled) : undefined
      const menu = buildMenu(template, win.id, prefix)
      menu.popup({
        window: win,
        x: options?.x,
        y: options?.y,
        callback: () => {
          popups.delete(win.id)
          try {
            event.sender.send('mt::menu::closed', { windowId: win.id })
          } catch {
            /* destroyed */
          }
        }
      })
    } catch (err) {
      popups.delete(win.id)
      log.error('menu popup failed:', err)
    }
  })

  ipcMain.on('mt::menu::popup-application', (event, position?: MenuPopupPosition) => {
    const win = windowFromEvent(event)
    if (!win) return
    try {
      const appMenu = Menu.getApplicationMenu()
      if (!appMenu) return
      appMenu.popup({ window: win, x: position?.x, y: position?.y })
    } catch (err) {
      log.error('application menu popup failed:', err)
    }
  })
}
