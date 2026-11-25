import { useProjectStore } from '@/store/project'
import { collectTreeSelectionRange } from './selectionRange'

type SelectionItem = { pathname?: unknown }

/** Shared Shift-click behavior for sidebar file, folder, and root rows. */
export const useTreeSelection = () => {
  const projectStore = useProjectStore()

  const selectRange = (event: MouseEvent, item: SelectionItem): boolean => {
    if (!event.shiftKey) return false
    const pathname = item?.pathname
    if (typeof pathname !== 'string' || !pathname) return false
    const currentTarget = event.currentTarget
    const scope = currentTarget instanceof Element ? currentTarget.closest('.tree-wrapper') : null
    const paths = collectTreeSelectionRange(projectStore.selectionAnchor, pathname, scope)
    projectStore.SELECT_RANGE(paths, item)
    return true
  }

  return { selectRange }
}
