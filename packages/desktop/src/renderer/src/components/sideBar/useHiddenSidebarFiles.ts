import { computed } from 'vue'
import { usePreferencesStore } from '@/store/preferences'
import {
  createHiddenSidebarPathSet,
  normalizeHiddenSidebarPath
} from '@/util/hiddenSidebarFiles'
import type { TreeFileNode } from './types'

export const useHiddenSidebarFiles = () => {
  const preferences = usePreferencesStore()
  const hiddenKeys = computed(() => createHiddenSidebarPathSet(preferences.hiddenSidebarPaths))

  const isHidden = (pathname: string): boolean =>
    hiddenKeys.value.has(normalizeHiddenSidebarPath(pathname))

  const visibleFiles = (files: readonly TreeFileNode[]): TreeFileNode[] =>
    files.filter(file => !isHidden(file.pathname))

  return { isHidden, visibleFiles }
}
