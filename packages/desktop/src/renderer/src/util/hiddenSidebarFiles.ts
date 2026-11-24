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
