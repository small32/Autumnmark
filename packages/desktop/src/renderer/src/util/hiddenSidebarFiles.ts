const usesCaseInsensitivePaths = (): boolean =>
  window.electron?.process?.platform === 'win32'

/** Stable key for comparing sidebar paths; Windows paths are case-insensitive. */
export const normalizeHiddenSidebarPath = (pathname: string): string => {
  const normalized = window.path.normalize(pathname)
  return usesCaseInsensitivePaths() ? normalized.toLowerCase() : normalized
}

export const createHiddenSidebarPathSet = (pathnames: readonly string[]): Set<string> =>
  new Set(pathnames.map(normalizeHiddenSidebarPath))

export const withHiddenSidebarPath = (
  pathnames: readonly string[],
  pathname: string
): string[] => {
  const key = normalizeHiddenSidebarPath(pathname)
  if (pathnames.some(item => normalizeHiddenSidebarPath(item) === key)) {
    return [...pathnames]
  }
  return [...pathnames, window.path.normalize(pathname)]
}

export const withoutHiddenSidebarPath = (
  pathnames: readonly string[],
  pathname: string
): string[] => {
  const key = normalizeHiddenSidebarPath(pathname)
  return pathnames
    .filter(item => normalizeHiddenSidebarPath(item) !== key)
    .map(item => window.path.normalize(item))
}

/** Prefix that matches a path itself plus everything beneath it. */
const subtreePrefix = (pathname: string): string => {
  const normalized = normalizeHiddenSidebarPath(pathname)
  if (normalized.endsWith('/') || normalized.endsWith('\\')) return normalized
  // Match the separator style produced by window.path.normalize on this platform.
  const separator = normalized.includes('\\') ? '\\' : '/'
  return normalized + separator
}

/** Rewrite hidden paths when a file or folder is renamed/moved. */
export const renameHiddenSidebarPaths = (
  pathnames: readonly string[],
  src: string,
  dest: string
): string[] => {
  const srcKey = normalizeHiddenSidebarPath(src)
  const prefix = subtreePrefix(src)
  const normalizedSrc = window.path.normalize(src)
  const normalizedDest = window.path.normalize(dest)
  return pathnames.map(item => {
    const normalizedItem = window.path.normalize(item)
    const itemKey = normalizeHiddenSidebarPath(item)
    if (itemKey === srcKey) return normalizedDest
    if (itemKey.startsWith(prefix))
      return normalizedDest + normalizedItem.slice(normalizedSrc.length)
    return normalizedItem
  })
}

/** Drop hidden paths for an item and its descendants after it is trashed. */
export const withoutHiddenSidebarSubtree = (
  pathnames: readonly string[],
  pathname: string
): string[] => {
  const key = normalizeHiddenSidebarPath(pathname)
  const prefix = subtreePrefix(pathname)
  return pathnames.filter(item => {
    const itemKey = normalizeHiddenSidebarPath(item)
    return itemKey !== key && !itemKey.startsWith(prefix)
  })
}

export const sameHiddenSidebarPaths = (
  a: readonly string[],
  b: readonly string[]
): boolean =>
  a.length === b.length && a.every((item, index) => normalizeHiddenSidebarPath(item) === normalizeHiddenSidebarPath(b[index]))
