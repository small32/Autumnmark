import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as { window?: Record<string, unknown> }
  w.window ??= {}
  w.window.path ??= {
    normalize: (pathname: string) => pathname.replace(/\\/g, '/'),
    basename: (pathname: string) => pathname.split('/').pop() ?? pathname,
    dirname: (pathname: string) => pathname.split('/').slice(0, -1).join('/') || '/',
    join: (...parts: string[]) => parts.join('/'),
    relative: (from: string, to: string) => to.startsWith(from + '/') ? to.slice(from.length + 1) : '..',
    isAbsolute: (pathname: string) => pathname.startsWith('/')
  }
  w.window.fileUtils ??= {
    hasMarkdownExtension: (name: string) => name.endsWith('.md'),
    pathExists: () => Promise.resolve(false),
    isSamePathSync: (a: string, b: string) => a === b
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

import { useProjectStore } from '@/store/project'
import { usePreferencesStore } from '@/store/preferences'

const invoke = (): ReturnType<typeof vi.fn> =>
  window.electron.ipcRenderer.invoke as unknown as ReturnType<typeof vi.fn>

const file = (pathname: string) => ({
  pathname,
  name: pathname.split('/').pop() ?? pathname,
  isFile: true,
  isDirectory: false,
  isMarkdown: true
})

const folder = (pathname: string) => ({
  pathname,
  name: pathname.split('/').pop() ?? pathname,
  isFile: false,
  isDirectory: true,
  isMarkdown: false,
  folders: [],
  files: []
})

describe('sidebar multi-selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('toggles files and folders into the selection case-insensitively', () => {
    const store = useProjectStore()
    store.TOGGLE_SELECTION(file('C:\\Notes\\A.md'))
    store.TOGGLE_SELECTION(folder('C:\\Notes\\Archive'))
    expect(store.selectedPaths).toEqual(['C:\\Notes\\A.md', 'C:\\Notes\\Archive'])
    expect(store.IS_MULTI_SELECTED('c:/notes/a.md')).toBe(true)
    expect(store.SELECTION_PATHS()).toEqual(['C:\\Notes\\A.md', 'C:\\Notes\\Archive'])

    // Toggling the same row again removes it and restores single selection.
    store.TOGGLE_SELECTION(file('c:/notes/A.MD'))
    expect(store.selectedPaths).toEqual(['C:\\Notes\\Archive'])
    expect(store.IS_MULTI_SELECTED('C:/Notes/a.md')).toBe(false)
    // One remaining path falls back to the active item.
    expect(store.SELECTION_PATHS()).toEqual([store.activeItem.pathname])
  })

  it('carries the plain-clicked row into a Ctrl+click selection', () => {
    const store = useProjectStore()
    const first = file('C:/Notes/A.md')

    // Seed eligibility requires the plain-clicked row to exist in the tree,
    // exactly like the sidebar rows the components pass in.
    store.APPLY_ROOTS({
      revision: 1,
      roots: [{ key: 'C:/Notes', pathname: 'C:/Notes', watchToken: 'root', status: 'ready' }],
      reason: 'restore'
    })
    store.roots[0].tree = {
      pathname: 'C:/Notes',
      name: 'Notes',
      isDirectory: true,
      isFile: false,
      isMarkdown: false,
      folders: [],
      files: [{ pathname: 'C:/Notes/A.md', name: 'A.md', isDirectory: false, isFile: true, isMarkdown: true }]
    }

    store.SELECT_SINGLE(first)
    store.TOGGLE_SELECTION(file('C:/Notes/B.md'))

    expect(store.selectedPaths).toEqual(['C:/Notes/A.md', 'C:/Notes/B.md'])
    expect(store.IS_MULTI_SELECTED('C:/Notes/A.md')).toBe(true)
    expect(store.IS_MULTI_SELECTED('C:/Notes/B.md')).toBe(true)
    expect(store.SELECTION_PATHS()).toEqual(['C:/Notes/A.md', 'C:/Notes/B.md'])
  })

  it('does not seed a hidden or stale row into the selection', () => {
    const store = useProjectStore()
    const preferences = usePreferencesStore()
    preferences.hiddenSidebarPaths = ['C:/Notes/Hidden.md']

    // No project root: the row no longer exists in any tree, so seeding it
    // would trash a file the user cannot see.
    store.CHANGE_ACTIVE_ITEM(file('C:\\Notes\\Hidden.md'))
    store.TOGGLE_SELECTION(file('C:\\Notes\\B.md'))
    expect(store.selectedPaths).toEqual(['C:\\Notes\\B.md'])
  })

  it('keeps the multi-selection when right-clicking one of its rows', () => {
    const store = useProjectStore()
    store.TOGGLE_SELECTION(file('C:\\Notes\\A.md'))
    store.TOGGLE_SELECTION(file('C:\\Notes\\B.md'))

    // Right-click calls CHANGE_ACTIVE_ITEM on the row.
    store.CHANGE_ACTIVE_ITEM(file('C:\\Notes\\A.md'))
    expect(store.selectedPaths).toHaveLength(2)
    expect(store.activeItem.pathname).toBe('C:\\Notes\\A.md')

    // Right-clicking a row outside the selection collapses to single select.
    store.CHANGE_ACTIVE_ITEM(file('C:\\Notes\\C.md'))
    expect(store.selectedPaths).toEqual([])
    expect(store.activeItem.pathname).toBe('C:\\Notes\\C.md')
  })

  it('collapses to one row on a plain click', () => {
    const store = useProjectStore()
    store.TOGGLE_SELECTION(file('C:\\Notes\\A.md'))
    store.TOGGLE_SELECTION(file('C:\\Notes\\B.md'))

    const target = folder('C:\\Notes\\Archive')
    store.SELECT_SINGLE(target)

    expect(store.selectedPaths).toEqual([])
    expect(store.activeItem).toEqual(target)
  })

  it('clears the selection explicitly', () => {
    const store = useProjectStore()
    store.TOGGLE_SELECTION(file('C:\\Notes\\A.md'))
    store.TOGGLE_SELECTION(file('C:\\Notes\\B.md'))
    store.CLEAR_SELECTION()
    expect(store.selectedPaths).toEqual([])
    expect(store.activeItem).toEqual({})
    expect(store.SELECTION_PATHS()).toEqual([])
  })

  it('hides the whole selection in a single persisted write', async() => {
    const project = useProjectStore()
    const preferences = usePreferencesStore()
    project.TOGGLE_SELECTION(file('C:\\Notes\\A.md'))
    project.TOGGLE_SELECTION(folder('C:\\Notes\\Archive'))

    await expect(preferences.HIDE_SIDEBAR_ITEMS(project.SELECTION_PATHS())).resolves.toBe(true)
    expect(preferences.hiddenSidebarPaths).toEqual(['C:/Notes/A.md', 'C:/Notes/Archive'])
    expect(invoke()).toHaveBeenCalledTimes(1)
    expect(invoke()).toHaveBeenLastCalledWith('mt::preferences::update', {
      hiddenSidebarPaths: ['C:/Notes/A.md', 'C:/Notes/Archive']
    })
  })

  it('falls back to the active row when there is no multi-selection', () => {
    const store = useProjectStore()
    store.CHANGE_ACTIVE_ITEM(file('C:\\Notes\\Single.md'))
    expect(store.SELECTION_PATHS()).toEqual(['C:\\Notes\\Single.md'])
  })
})
