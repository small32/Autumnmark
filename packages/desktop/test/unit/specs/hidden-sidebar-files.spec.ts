import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, h, nextTick, type App } from 'vue'
import { createI18n } from 'vue-i18n'
import en from '../../../static/locales/en.json'
import HiddenFiles from '../../../src/renderer/src/prefComponents/general/hiddenFiles.vue'

vi.hoisted(() => {
  const w = globalThis as unknown as { window?: Record<string, unknown> }
  w.window ??= {}
  w.window.path ??= {
    normalize: (pathname: string) => pathname.replace(/\\/g, '/'),
    basename: (pathname: string) => pathname.split('/').pop() ?? pathname
  }
  w.window.electron ??= {
    process: { platform: 'win32' },
    ipcRenderer: {
      invoke: vi.fn(async() => ({ status: 'persisted' })),
      send: vi.fn(),
      on: vi.fn()
    }
  }
})

import { usePreferencesStore } from '@/store/preferences'
import { useHiddenSidebarFiles } from '@/components/sideBar/useHiddenSidebarFiles'
import type { TreeFileNode, TreeFolderNode } from '@/components/sideBar/types'

const invoke = (): ReturnType<typeof vi.fn> =>
  window.electron.ipcRenderer.invoke as unknown as ReturnType<typeof vi.fn>

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

describe('sidebar hidden files', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('hides a file once and persists the normalized path', async() => {
    const store = usePreferencesStore()

    await expect(store.HIDE_SIDEBAR_ITEM('C:\\Notes\\Draft.md')).resolves.toBe(true)
    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/Draft.md'])
    expect(invoke()).toHaveBeenLastCalledWith('mt::preferences::update', {
      hiddenSidebarPaths: ['C:/Notes/Draft.md']
    })

    await expect(store.HIDE_SIDEBAR_ITEM('c:/notes/draft.md')).resolves.toBe(true)
    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/Draft.md'])
  })

  it('restores a path case-insensitively on Windows', async() => {
    const store = usePreferencesStore()
    await store.HIDE_SIDEBAR_ITEM('C:\\Notes\\Draft.md')

    await expect(store.RESTORE_SIDEBAR_ITEM('c:/NOTES/DRAFT.MD')).resolves.toBe(true)
    expect(store.hiddenSidebarPaths).toEqual([])
  })

  it('keeps the list when the preferences file rejects the update', async() => {
    const store = usePreferencesStore()
    invoke().mockResolvedValueOnce({ status: 'failed', reason: 'storage-unavailable' })

    await expect(store.HIDE_SIDEBAR_ITEM('C:\\Notes\\Draft.md')).resolves.toBe(false)
    expect(store.hiddenSidebarPaths).toEqual([])
  })

  it('serializes overlapping hide calls without losing an update', async() => {
    const store = usePreferencesStore()

    // Fire both hides before the first IPC settles; both must survive.
    await Promise.all([
      store.HIDE_SIDEBAR_ITEM('C:\\Notes\\A.md'),
      store.HIDE_SIDEBAR_ITEM('C:\\Notes\\B.md')
    ])
    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/A.md', 'C:/Notes/B.md'])
    expect(invoke()).toHaveBeenLastCalledWith('mt::preferences::update', {
      hiddenSidebarPaths: ['C:/Notes/A.md', 'C:/Notes/B.md']
    })
  })

  it('restores every hidden file at once', async() => {
    const store = usePreferencesStore()
    await store.HIDE_SIDEBAR_ITEM('C:\\Notes\\A.md')
    await store.HIDE_SIDEBAR_ITEM('C:\\Notes\\B.md')

    await expect(store.RESTORE_ALL_SIDEBAR_ITEMS()).resolves.toBe(true)
    expect(store.hiddenSidebarPaths).toEqual([])
    expect(invoke()).toHaveBeenLastCalledWith('mt::preferences::update', {
      hiddenSidebarPaths: []
    })
  })

  it('filters both hidden folders and hidden files from the sidebar', () => {
    const store = usePreferencesStore()
    store.hiddenSidebarPaths = ['C:\\Notes\\Archive', 'C:\\Notes\\draft.md']
    const { visibleFiles, visibleFolders } = useHiddenSidebarFiles()
    const folder = (name: string): TreeFolderNode => ({
      pathname: `C:\\Notes\\${name}`,
      name,
      folders: [],
      files: [],
      isDirectory: true,
      isFile: false,
      isMarkdown: false
    })
    const file = (name: string): TreeFileNode => ({
      pathname: `C:\\Notes\\${name}`,
      name,
      isDirectory: false,
      isFile: true,
      isMarkdown: true
    })

    expect(visibleFolders([folder('Archive'), folder('Work')]).map(item => item.name)).toEqual(['Work'])
    expect(visibleFiles([file('draft.md'), file('keep.md')]).map(item => item.name)).toEqual(['keep.md'])
  })

  it('carries hidden state over when a hidden item is renamed', async() => {
    const store = usePreferencesStore()
    store.hiddenSidebarPaths = ['C:/Notes/Draft.md', 'C:/Notes/Keep.md']

    await expect(store.RENAME_HIDDEN_SIDEBAR_ITEM('C:\\Notes\\Draft.md', 'C:\\Notes\\Final.md')).resolves.toBe(true)
    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/Final.md', 'C:/Notes/Keep.md'])
    expect(invoke()).toHaveBeenLastCalledWith('mt::preferences::update', {
      hiddenSidebarPaths: ['C:/Notes/Final.md', 'C:/Notes/Keep.md']
    })
  })

  it('rewrites descendants when a hidden folder is renamed', async() => {
    const store = usePreferencesStore()
    store.hiddenSidebarPaths = ['C:/Notes/Archive', 'C:/Notes/Archive/a.md', 'C:/Notes/Other/b.md']

    await store.RENAME_HIDDEN_SIDEBAR_ITEM('C:\\Notes\\Archive', 'C:\\Notes\\Backup')
    expect(store.hiddenSidebarPaths).toEqual([
      'C:/Notes/Backup',
      'C:/Notes/Backup/a.md',
      'C:/Notes/Other/b.md'
    ])
  })

  it('drops hidden entries for a trashed item and its descendants', async() => {
    const store = usePreferencesStore()
    store.hiddenSidebarPaths = ['C:/Notes/Archive', 'C:/Notes/Archive/a.md', 'C:/Notes/Keep.md']

    await expect(store.REMOVE_HIDDEN_SIDEBAR_ITEM('C:\\Notes\\Archive')).resolves.toBe(true)
    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/Keep.md'])
  })

  it('does not write when a rename leaves the hidden list unchanged', async() => {
    const store = usePreferencesStore()
    store.hiddenSidebarPaths = ['C:/Notes/Keep.md']
    invoke().mockClear()

    await store.RENAME_HIDDEN_SIDEBAR_ITEM('C:\\Notes\\Unrelated.md', 'C:\\Notes\\Other.md')
    expect(invoke()).not.toHaveBeenCalled()
    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/Keep.md'])
  })

  it('lists hidden items in settings and restores the selected one', async() => {
    const store = usePreferencesStore()
    store.hiddenSidebarPaths = ['C:\\Notes\\A.md', 'C:\\Notes\\B.md']
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({ render: () => h(HiddenFiles) })
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
    app.mount(root)
    await nextTick()

    expect(root.querySelectorAll('.hidden-file-list li')).toHaveLength(2)
    expect(root.querySelector('.hidden-file-list')?.textContent).toContain('A.md')

    root.querySelector<HTMLButtonElement>('.restore')?.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()

    expect(store.hiddenSidebarPaths).toEqual(['C:/Notes/B.md'])
    expect(root.querySelectorAll('.hidden-file-list li')).toHaveLength(1)
  })
})
