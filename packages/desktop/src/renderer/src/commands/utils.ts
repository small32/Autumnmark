// Portable and unsigned builds cannot install updates, but they can still ask
// GitHub for the latest release and open the download page.
export const canCheckForUpdates = (): boolean => {
  return !!(window.electron && window.electron.canCheckForUpdates)
}
