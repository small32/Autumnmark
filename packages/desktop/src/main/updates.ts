import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import type { UpdateState } from '@shared/types/ipc'
import { isUpdatable } from './utils/isUpdatable'
import { onInternalChannel } from './utils/internalIpc'

const listeners = new Set<WebContents>()
let state: UpdateState = { phase: 'idle' }
let busy = false
let announceDownload = false
let pendingDialog: WebContents | 'any' | undefined
let startupCheckDone = false
// Bumped when the user turns notices off while a check/download is in flight.
// In-flight tasks still finish, but their late state must not resurrect a
// notice the user just dismissed in settings.
let dismissedNoticeGeneration = 0
let getActiveWindow: (() => BrowserWindow | null) | undefined
let readPreferences: (() => PreferenceReader | null) | null = null

interface PreferenceReader {
  getItem(key: string): unknown
}

const readBooleanPreference = (key: string, fallback: boolean): boolean => {
  const preferences = readPreferences?.()
  const value = preferences?.getItem(key)
  return typeof value === 'boolean' ? value : fallback
}

// Default to enabled so menu-triggered checks keep working before preferences
// are wired up (and in the update specs, which do not construct the accessor).
const noticesEnabled = (): boolean => readBooleanPreference('checkUpdatesOnStartup', true)
export const onlineUpdatesEnabled = (): boolean => readBooleanPreference('onlineUpdateEnabled', true)

autoUpdater.allowPrerelease = false
autoUpdater.autoDownload = false
// Prefetching a package must not turn a normal exit into consent to install it.
autoUpdater.autoInstallOnAppQuit = false

const publish = (next: UpdateState): void => {
  state = next
  for (const listener of listeners) listener.send('mt::update-state', state)
}

const showDialog = (win: BrowserWindow | null): void => {
  // The update notice is opt-out; a disabled notice also suppresses the dialog
  // for manual checks. Settings still shows the check result inline.
  if (!noticesEnabled()) return
  const target = win && !win.isDestroyed() ? win.webContents : listeners.values().next().value
  if (target && listeners.has(target)) {
    target.send('mt::update-state', state, true)
  } else {
    pendingDialog = target ?? 'any'
  }
}

ipcMain.on('mt::update-listen', ({ sender }) => {
  if (!listeners.has(sender)) {
    listeners.add(sender)
    sender.once('destroyed', () => {
      listeners.delete(sender)
      if (pendingDialog === sender) pendingDialog = 'any'
    })
  }
  const show = noticesEnabled() && (pendingDialog === 'any' || pendingDialog === sender)
  if (show) pendingDialog = undefined
  sender.send('mt::update-state', state, show)
})

autoUpdater.on('download-progress', ({ transferred, total, bytesPerSecond }) => {
  if (state.phase === 'downloading') {
    publish({ ...state, progress: { transferred, total, bytesPerSecond } })
  }
})

const reportInstallError = (error: unknown): void => {
  if (state.phase === 'installing') {
    log.warn('Update installation failed:', error)
    publish({ phase: 'error', stage: 'install', version: state.version })
  }
}
// Platform installers can report launch errors after quitAndInstall returns.
autoUpdater.on('error', reportInstallError)

ipcMain.on('mt::update-install', (_event, version: string) => {
  if (!onlineUpdatesEnabled()) return
  if (state.phase !== 'ready' && !(state.phase === 'error' && state.stage === 'install')) return
  if (!version || state.version !== version) return
  publish({ phase: 'installing', version })
  try {
    autoUpdater.quitAndInstall()
  } catch (error) {
    reportInstallError(error)
  }
})

ipcMain.on('mt::update-background', () => {
  announceDownload = false
  pendingDialog = undefined
})

const runCheck = async(automatic: boolean, getWindow: () => BrowserWindow | null): Promise<void> => {
  if (automatic && !noticesEnabled()) return
  const generation = dismissedNoticeGeneration
  const previous = state
  const cached = previous.phase === 'ready' || (previous.phase === 'error' && previous.stage === 'install')
  if (!automatic) {
    announceDownload = false
    if (!cached && state.phase !== 'downloading' && state.phase !== 'installing') {
      publish({ phase: 'checking' })
    }
    showDialog(getWindow())
  }
  if (busy || state.phase === 'installing' || (!automatic && cached)) return
  busy = true
  announceDownload = automatic && noticesEnabled()
  let version: string | undefined
  try {
    const result = await autoUpdater.checkForUpdates()
    if (generation !== dismissedNoticeGeneration) return
    // A cached installer may have been launched during a startup release check.
    if (cached && state !== previous) return
    if (!result) {
      if (!cached) publish({ phase: 'error', stage: 'check' })
      return
    }
    if (!result.isUpdateAvailable) {
      publish({ phase: 'current' })
      return
    }
    version = result.updateInfo.version
    if (cached && previous.version === version) return

    // Online updates are optional. With the switch off we still report the new
    // version, but never fetch or install a package in the background.
    if (!onlineUpdatesEnabled()) {
      publish({ phase: 'available', version })
      if (announceDownload) showDialog(getWindow())
      return
    }

    publish({ phase: 'downloading', version, progress: null })
    await autoUpdater.downloadUpdate()
    if (generation !== dismissedNoticeGeneration) return
    // Switching to release-page-only updates mid-download must not present a
    // ready-to-install package the installer switch now refuses to install.
    if (!onlineUpdatesEnabled()) {
      publish({ phase: 'available', version })
      if (announceDownload) showDialog(getWindow())
      return
    }
    publish({ phase: 'ready', version })
    if (announceDownload) showDialog(getWindow())
  } catch (error) {
    log.warn('Software update failed:', error)
    if (generation !== dismissedNoticeGeneration) return
    if (version) publish({ phase: 'error', stage: 'download', version })
    else if (!cached) publish({ phase: 'error', stage: 'check' })
  } finally {
    busy = false
    // An in-flight check discarded by a dismissed notice (or a quick
    // off→on toggle while it ran) leaves the state idle without any check
    // scheduled; run the promised check once notices are back on.
    if (noticesEnabled() && state.phase === 'idle') void runCheck(true, getWindow)
  }
}

const handlePreferenceChange = (patch: Record<string, unknown>): void => {
  const windowGetter = getActiveWindow ?? (() => null)
  if ('checkUpdatesOnStartup' in patch) {
    if (!noticesEnabled()) {
      announceDownload = false
      pendingDialog = undefined
      dismissedNoticeGeneration += 1
      if (state.phase !== 'idle') publish({ phase: 'idle' })
    } else if (!busy && state.phase === 'idle') {
      void runCheck(true, windowGetter)
    }
  }
  if ('onlineUpdateEnabled' in patch && onlineUpdatesEnabled() && state.phase === 'available') {
    void runCheck(false, windowGetter)
  }
}

onInternalChannel<[Record<string, unknown>]>('broadcast-preferences-changed', patch => {
  handlePreferenceChange(patch)
})

export const checkUpdates = (win: BrowserWindow | null): void => {
  void runCheck(false, () => win)
}

ipcMain.on('mt::check-for-update', ({ sender }) => {
  void runCheck(false, () => BrowserWindow.fromWebContents(sender))
})

export const startAutomaticUpdateChecks = (
  getWindow: () => BrowserWindow | null,
  getPreferences?: (() => PreferenceReader | null) | null
): void => {
  getActiveWindow = getWindow
  readPreferences = getPreferences ?? null
  // Only one silent check on startup; further checks are explicitly requested
  // from settings or through the update menu.
  if (startupCheckDone || !isUpdatable()) return
  startupCheckDone = true
  void runCheck(true, getWindow)
}
