import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const w = globalThis as unknown as { window?: Record<string, unknown> }
  w.window ??= {}
  w.window.path ??= {
    normalize: (pathname: string) => pathname.replace(/\\/g, '/')
  }
  w.window.electron ??= {
    process: { platform: 'win32' }
  }
})

import { collectTreeSelectionRange } from '@/components/sideBar/selectionRange'

const renderTree = (): void => {
  document.body.innerHTML = `
    <div class="tree-wrapper">
      <div data-tree-path="C:/Notes"></div>
      <div data-tree-path="C:/Notes/A.md"></div>
      <div class="tree-contents" style="display: none">
        <div data-tree-path="C:/Notes/Collapsed"></div>
      </div>
      <div data-tree-path="C:/Notes/Archive"></div>
      <div data-tree-path="C:/Notes/B.md"></div>
    </div>
  `
}

describe('sidebar Shift selection range', () => {
  beforeEach(() => {
    renderTree()
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
      if (this.closest('[style*="display: none"]')) return [] as unknown as DOMRectList
      return [{} as DOMRect] as unknown as DOMRectList
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects visible rows from the anchor to the clicked row', () => {
    const scope = document.querySelector('.tree-wrapper')
    expect(collectTreeSelectionRange('c:/notes', 'C:\\Notes\\B.md', scope)).toEqual([
      'C:/Notes',
      'C:/Notes/A.md',
      'C:/Notes/Archive',
      'C:/Notes/B.md'
    ])
  })

  it('handles a reversed range', () => {
    const scope = document.querySelector('.tree-wrapper')
    expect(collectTreeSelectionRange('C:/Notes/B.md', 'C:/Notes/A.md', scope)).toEqual([
      'C:/Notes/A.md',
      'C:/Notes/Archive',
      'C:/Notes/B.md'
    ])
  })

  it('falls back to the clicked row when the anchor is not visible', () => {
    const scope = document.querySelector('.tree-wrapper')
    expect(
      collectTreeSelectionRange('C:/Notes/Collapsed', 'C:/Notes/Archive', scope)
    ).toEqual(['C:/Notes/Archive'])
  })
})
