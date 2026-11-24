import { describe, expect, it, vi } from 'vitest'

const popup = vi.hoisted(() => vi.fn())
vi.mock('@/contextMenu/popupMenu', () => ({ popupContextMenu: popup }))

import bus from '@/bus'
import { showContextMenu } from '@/contextMenu/sideBar'
import type { ContextMenuItem } from '@/contextMenu/popupMenu'
import type { TreeFileNode, TreeFolderNode } from '@/components/sideBar/types'

const file: TreeFileNode = {
  pathname: '/notes/entry.md',
  name: 'entry.md',
  isDirectory: false,
  isFile: true,
  isMarkdown: true
}

const folder: TreeFolderNode = {
  pathname: '/notes',
  name: 'notes',
  folders: [],
  files: [],
  isDirectory: true,
  isFile: false,
  isMarkdown: false
}

const menuItems = (): ContextMenuItem[] => popup.mock.lastCall?.[0] as ContextMenuItem[]

describe('sidebar context menu hiding', () => {
  it('offers hiding for files and emits the sidebar action', () => {
    showContextMenu({ clientX: 1, clientY: 2 }, false, file)
    const hide = menuItems().find(item => item.id === 'hideMenuItem')
    expect(hide?.label).toBe('Hide from Sidebar')

    const emit = vi.spyOn(bus, 'emit')
    hide?.click?.()
    expect(emit).toHaveBeenCalledWith('SIDEBAR::hide')
    emit.mockRestore()
  })

  it('offers hiding for folders too', () => {
    showContextMenu({ clientX: 1, clientY: 2 }, false, folder)
    const hide = menuItems().find(item => item.id === 'hideMenuItem')
    expect(hide?.label).toBe('Hide from Sidebar')

    const emit = vi.spyOn(bus, 'emit')
    hide?.click?.()
    expect(emit).toHaveBeenCalledWith('SIDEBAR::hide')
    emit.mockRestore()
  })
})
