import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// #2245: on Windows every window draws its own menu bar, and
// `Menu.setApplicationMenu` writes the menu into *all* of them. Switching the
// application menu on focus therefore stripped the menu bar from the editor
// window while Preferences was focused, and handed the Preferences window the
// editor's menu bar as soon as the editor was focused again.
//
// The fake windows below mirror what Electron 42 actually does on those
// platforms: `Menu.setApplicationMenu` is `getAllWindows().map(w =>
// w.setMenu(menu))`, and a window created afterwards inherits the application
// menu in `BaseWindow._init`.

interface FakeMenu {
  template: unknown
  getMenuItemById: () => { checked: boolean; enabled: boolean }
  items: Array<{
    label: string
    visible: boolean
    enabled: boolean
    submenu?: { popup: ReturnType<typeof vi.fn> }
  }>
}

const {
  buildFromTemplate,
  setApplicationMenu,
  getApplicationMenu,
  fromId,
  configureMenu,
  configSettingMenu,
  createWindow,
  reset
} = vi.hoisted(() => {
  let applicationMenu: unknown = null
  const windows = new Map<number, { id: number; menu: unknown; isDestroyed: () => boolean }>()

  const createWindow = (id: number) => {
    const win = {
      id,
      menu: applicationMenu,
      setMenu: vi.fn(function(this: { menu: unknown }, menu: unknown) {
        this.menu = menu
      }),
      removeMenu: vi.fn(function(this: { menu: unknown }) {
        this.menu = null
      }),
      isDestroyed: () => false
    }
    windows.set(id, win)
    return win
  }

  return {
    windows,
    createWindow,
    reset: () => {
      applicationMenu = null
      windows.clear()
    },
    buildFromTemplate: vi.fn(
      (template: unknown): FakeMenu => ({
        template,
        items: [],
        getMenuItemById: () => ({ checked: false, enabled: true })
      })
    ),
    setApplicationMenu: vi.fn((menu: unknown) => {
      applicationMenu = menu
      for (const win of windows.values()) {
        ;(win as unknown as { setMenu: (m: unknown) => void }).setMenu(menu)
      }
    }),
    getApplicationMenu: vi.fn(() => applicationMenu),
    fromId: vi.fn((id: number) => windows.get(id) ?? null),
    configureMenu: vi.fn(() => ['EDITOR_TEMPLATE']),
    configSettingMenu: vi.fn(() => ['SETTINGS_TEMPLATE'])
  }
})

vi.mock('electron', () => ({
  app: { addRecentDocument: vi.fn(), clearRecentDocuments: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn(), emit: vi.fn() },
  Menu: { buildFromTemplate, setApplicationMenu, getApplicationMenu },
  BrowserWindow: { fromId, fromWebContents: (sender: { window: unknown }) => sender.window }
}))

vi.mock('common/filesystem', () => ({
  ensureDirSync: vi.fn(),
  isDirectory2: () => false,
  isFile2: () => false
}))

vi.mock('main_renderer/config', () => ({ isOsx: false, isWindows: true }))

vi.mock('main_renderer/menu/actions/edit', () => ({ updateSidebarMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/format', () => ({ updateFormatMenu: vi.fn() }))
vi.mock('main_renderer/menu/actions/paragraph', () => ({ updateSelectionMenus: vi.fn() }))
vi.mock('main_renderer/menu/actions/view', () => ({ viewLayoutChanged: vi.fn() }))
vi.mock('main_renderer/utils/internalIpc', () => ({ onInternalChannel: vi.fn() }))
vi.mock('main_renderer/i18n.js', () => ({ setLanguage: vi.fn() }))
vi.mock('main_renderer/menu/templates', () => ({
  default: configureMenu,
  configSettingMenu
}))

import AppMenu from 'main_renderer/menu'
import type Preference from 'main_renderer/preferences'
import type Keybindings from 'main_renderer/keyboard/shortcutHandler'

const makeAppMenu = () => {
  const preferences = { getItem: () => 'en' } as unknown as Preference
  const keybindings = {
    registerEditorKeyHandlers: vi.fn(),
    registerAccelerator: vi.fn()
  } as unknown as Keybindings
  return new AppMenu(preferences, keybindings, '/tmp/mt-test')
}

describe('Editor and Preferences keep their own menu bar on Windows (#2245)', () => {
  beforeEach(() => {
    reset()
    buildFromTemplate.mockClear()
    setApplicationMenu.mockClear()
  })

  it('leaves the editor menu bar in place while Preferences is focused', () => {
    const appMenu = makeAppMenu()
    const editor = createWindow(1)
    appMenu.addEditorMenu(editor as never)
    appMenu.setActiveWindow(1)

    const editorMenu = editor.menu
    expect(editorMenu).toBeTruthy()

    const settings = createWindow(2)
    appMenu.addSettingMenu(settings as never)
    appMenu.setActiveWindow(2)

    expect(editor.menu).toBe(editorMenu)
    expect(settings.menu).toBeNull()
  })

  it('does not hand the editor menu bar to Preferences when the editor is refocused', () => {
    const appMenu = makeAppMenu()
    const editor = createWindow(1)
    appMenu.addEditorMenu(editor as never)
    appMenu.setActiveWindow(1)
    const editorMenu = editor.menu

    const settings = createWindow(2)
    appMenu.addSettingMenu(settings as never)
    appMenu.setActiveWindow(2)
    appMenu.setActiveWindow(1)

    expect(settings.menu).toBeNull()
    expect(editor.menu).toBe(editorMenu)
  })

  it('gives a Preferences window opened from the editor no menu bar at all', () => {
    const appMenu = makeAppMenu()
    const editor = createWindow(1)
    appMenu.addEditorMenu(editor as never)
    appMenu.setActiveWindow(1)

    // Electron hands the application menu to every window it creates, so the
    // settings window arrives wearing the editor's menu bar.
    const settings = createWindow(2)
    appMenu.addSettingMenu(settings as never)

    expect(settings.menu).toBeNull()
  })

  it('allows updates for a Preferences window without a menu bar', () => {
    const appMenu = makeAppMenu()
    const settings = createWindow(2)
    appMenu.addSettingMenu(settings as never)

    expect(appMenu.getWindowMenuById(2)).toBeNull()
    expect(() => appMenu.updateLineEndingMenu(2, 'lf')).not.toThrow()
    expect(() => appMenu.updateAlwaysOnTopMenu(2, true)).not.toThrow()
    expect(settings.menu).toBeNull()
  })
})

describe('Title bar menus use the requesting window', () => {
  beforeEach(() => {
    reset()
    vi.mocked(ipcMain.handle).mockClear()
  })

  const setup = () => {
    const appMenu = makeAppMenu()
    const editor = createWindow(1)
    appMenu.addEditorMenu(editor as never)
    const menu = editor.menu as FakeMenu
    const popup = vi.fn(({ callback }: { callback: () => void }) => callback())
    menu.items = [
      { label: 'File', visible: true, enabled: true, submenu: { popup } },
      { label: 'Hidden', visible: false, enabled: true, submenu: { popup } },
      { label: 'Format', visible: true, enabled: false, submenu: { popup } }
    ]
    const settings = createWindow(2)
    appMenu.addSettingMenu(settings as never)
    appMenu.setActiveWindow(2)
    const event = { sender: { window: editor, getZoomFactor: () => 1.5 } }
    const handler = (channel: string) => {
      const registration = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
      if (!registration) throw new Error(`Missing handler: ${channel}`)
      return registration[1]
    }
    return { editor, event, handler, popup }
  }

  it('lists visible categories even when another window is active', () => {
    const { event, handler } = setup()
    const categories = handler('mt::menu::application-categories')(event as never)
    expect(categories).toEqual([
      { index: 0, label: 'File', enabled: true },
      { index: 2, label: 'Format', enabled: false }
    ])
  })

  it('opens the existing submenu with zoom-corrected bounds', async() => {
    const { editor, event, handler, popup } = setup()
    await handler('mt::menu::popup-application-category')(event as never, 0, { x: 10, y: 32 })
    expect(popup).toHaveBeenCalledWith({
      window: editor,
      x: 15,
      y: 48,
      callback: expect.any(Function)
    })
  })

  it('ignores unavailable categories and invalid positions', async() => {
    const { event, handler, popup } = setup()
    const open = handler('mt::menu::popup-application-category')
    for (const index of [-1, 1, 2, 9, 0.5]) {
      await open(event as never, index, { x: 10, y: 32 })
    }
    await open(event as never, 0, { x: NaN, y: 32 })
    expect(popup).not.toHaveBeenCalled()
  })
})
