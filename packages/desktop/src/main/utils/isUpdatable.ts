import path from 'path'
import { isFile } from 'common/filesystem'

export const isUpdatable = (): boolean => {
  const resources = process.resourcesPath
  if (!resources || !isFile(path.join(resources, 'app-update.yml'))) return false
  // Only NSIS installs carry this marker; ZIP builds have no installed app to replace.
  return process.platform === 'win32' && isFile(path.join(resources, 'nsis-installed'))
}

// A portable ZIP cannot replace itself, but it can still ask GitHub for the
// latest release and send the user to the download page.
// `process.defaultApp` is set only while Electron runs unpackaged.
export const canCheckForUpdates = (): boolean =>
  isUpdatable() || (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp !== true

// Windows installations and macOS bundles can be replaced in place by the
// updater script.
export const canInstallInPlace = (): boolean =>
  process.platform === 'win32' || process.platform === 'darwin'
