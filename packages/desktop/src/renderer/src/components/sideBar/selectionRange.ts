import { normalizeHiddenSidebarPath } from '@/util/hiddenSidebarFiles'

const TREE_ROW_SELECTOR = '[data-tree-path]'

/** Rows rendered inside the given tree scope, in visual document order. */
const visibleTreeRows = (scope: ParentNode): HTMLElement[] => {
  return Array.from(scope.querySelectorAll<HTMLElement>(TREE_ROW_SELECTOR)).filter((row) => {
    // Root contents use `v-show`, so collapsed rows stay in the DOM. Range
    // selection must follow what the user can actually see.
    return row.isConnected && row.getClientRects().length > 0
  })
}

/**
 * Collect the rows between the selection anchor and the Shift-clicked row.
 * Collapsed descendants and hidden sidebar paths have no rendered row and are
 * therefore skipped. When the anchor is missing or not visible, the clicked
 * row alone is selected.
 */
export const collectTreeSelectionRange = (
  anchorPath: string | null | undefined,
  targetPath: string,
  scope: ParentNode | null
): string[] => {
  if (!scope) return [targetPath]

  const rows = visibleTreeRows(scope)
  const findIndex = (pathname: string | null | undefined): number => {
    if (typeof pathname !== 'string' || !pathname) return -1
    const key = normalizeHiddenSidebarPath(pathname)
    return rows.findIndex((row) => {
      const rowPath = row.dataset.treePath
      return typeof rowPath === 'string' && normalizeHiddenSidebarPath(rowPath) === key
    })
  }

  const anchorIndex = findIndex(anchorPath)
  const targetIndex = findIndex(targetPath)
  const start = Math.min(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex)
  const end = Math.max(anchorIndex < 0 ? targetIndex : anchorIndex, targetIndex)
  if (start < 0 || end < 0) return [targetPath]

  const paths: string[] = []
  const seen = new Set<string>()
  for (let index = start; index <= end; index++) {
    const pathname = rows[index].dataset.treePath
    if (typeof pathname !== 'string' || !pathname) continue
    const key = normalizeHiddenSidebarPath(pathname)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(pathname)
  }
  return paths
}
