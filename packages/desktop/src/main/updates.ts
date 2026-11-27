import fs from 'node:fs/promises'
import path from 'node:path'
import { app, ipcMain, net, BrowserWindow, type WebContents } from 'electron'
import log from 'electron-log'
import type { UpdateState } from '@shared/types/ipc'
import { APP_NAME, GITHUB_REPO_SLUG } from '@shared/brand'
import { canCheckForUpdates, canInstallInPlace } from './utils/isUpdatable'
import { isNewerRelease } from './utils/releaseVersion'
import {
  createUpdateAttemptDirectory, downloadFile, extractArchive, isLocalFileError,
  launchApplyScript, parseChecksums, resolveApplyScript, resolveInstallTarget,
  resolveReleaseAssets, stagedBundlePath, verifyChecksum, type ApplyMode
} from './inPlaceUpdate'
import { onInternalChannel } from './utils/internalIpc'

const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`
const RELEASE_CHECK_TIMEOUT_MS = 30_000

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
let quitForUpdate: ((launchInstaller: () => Promise<void>) => Promise<boolean>) | undefined
let downloadAbort: AbortController | null = null
interface StagedUpdate {
  version: string
  root: string
  staging: string
  archive: string
}
let staged: StagedUpdate | null = null

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

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))

const fetchLatestReleaseOnce = async(): Promise<string> => {
  // net.fetch uses the Chromium network stack, so the check honours the
  // system proxy and certificate store instead of failing like undici does.
  const response = await net.fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${APP_NAME}/${app.getVersion()}`
    },
    signal: AbortSignal.timeout(RELEASE_CHECK_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
  const payload: unknown = await response.json()
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('tag_name' in payload) ||
    typeof payload.tag_name !== 'string' ||
    !payload.tag_name.trim()
  )
    throw new Error('GitHub release has no tag')
  return payload.tag_name
}

// Flaky connections are the common failure here, not bad responses: retry a
// couple of times with a short backoff. Client errors (404, rate limit) are
// reported straight away because retrying cannot help.
const isRetryable = (error: unknown): boolean => {
  if (!(error instanceof Error)) return true
  const status = /^GitHub returned (\d{3})$/.exec(error.message)
  if (!status) return true
  return Number(status[1]) >= 500
}

const fetchLatestRelease = async(): Promise<string> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchLatestReleaseOnce()
    } catch (error) {
      lastError = error
      if (attempt === 2 || !isRetryable(error)) break
      await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
    }
  }
  throw lastError
}

// Keep downloaded packages next to the program (D:\Tools\AutumnMark+\update)
// instead of in the system Temp directory. On macOS the app bundle is a
// read-only package, so non-Windows builds keep using the OS temp folder.
const updateRoot = (version: string): string =>
  process.platform === 'win32'
    ? path.join(path.dirname(app.getPath('exe')), 'update', version)
    : path.join(app.getPath('temp'), 'autumnmark-update', version)

// Each attempt gets a fresh directory. Reusing a fixed path means a previous
// staging tree that is still locked (an antivirus scan or a half-finished
// install) makes the *next* download fail with EBUSY — reported to the user as
// a network error. Failed directories are left in place (or cleaned by the OS
// temp sweep on non-Windows) rather than deleting a file another process may
// still be reading.
const freshUpdateRoot = (version: string): Promise<string> =>
  createUpdateAttemptDirectory(updateRoot(version))

const downloadRelease = async(version: string): Promise<void> => {
  const assets = resolveReleaseAssets(version)
  if (!assets.length) throw new Error('This platform has no release archive')
  const [archiveAsset, sumsAsset] = assets
  const directory = await freshUpdateRoot(version)

  const archive = path.join(directory, archiveAsset.name)
  downloadAbort = new AbortController()
  publish({ phase: 'downloading', version, progress: { transferred: 0, total: 0, bytesPerSecond: 0 } })
  try {
    await downloadFile(archiveAsset.url, archive, progress => {
      if (state.phase === 'downloading') publish({ ...state, progress })
    }, downloadAbort.signal)

    const sumsPath = path.join(directory, sumsAsset.name)
    await downloadFile(sumsAsset.url, sumsPath, () => {}, downloadAbort.signal)
    const sums = parseChecksums(await fs.readFile(sumsPath, 'utf8'))
    const expected = sums.get(archiveAsset.name)
    if (!expected) throw new Error('The release has no checksum for this archive')
    await verifyChecksum(archive, expected)

    const staging = path.join(directory, 'staging')
    await extractArchive(archive, staging)
    staged = { version, root: directory, staging, archive }
    publish({ phase: 'ready', version })
    if (announceDownload && getActiveWindow) showDialog(getActiveWindow())
  } catch (error) {
    if (isAbortError(error)) {
      publish({ phase: 'available', version })
      return
    }
    throw error
  } finally {
    downloadAbort = null
  }
}

const applyUpdate = async(version: string): Promise<void> => {
  if (!staged || staged.version !== version) throw new Error('The update archive is not staged')
  const quit = quitForUpdate
  if (!quit) throw new Error('The application cannot quit for an update')
  publish({ phase: 'installing', version })
  const install = resolveInstallTarget()
  const bundle = install.mode === 'app' ? await stagedBundlePath(staged.staging) : null
  const scriptSource = await resolveApplyScript(staged.staging, bundle)
  // Run a copy outside the staged tree: the script must not be read from a
  // directory that the swap is about to overwrite.
  const runDirectory = path.join(staged.root, 'run')
  await fs.mkdir(runDirectory, { recursive: true })
  const script = path.join(runDirectory, path.basename(scriptSource))
  await fs.copyFile(scriptSource, script)
  let source: string
  if (install.mode === 'app') {
    if (!bundle) throw new Error('The update archive has no application bundle')
    source = bundle
  } else {
    source = staged.staging
  }
  const cleanup = staged.root
  const logPath = path.join(app.getPath('logs'), 'update.log')
  const mode: ApplyMode = install.mode

  const closing = await quit(async() => {
    const { elevated } = await launchApplyScript({
      script, source, target: install.target, launch: install.launch, mode, cleanup, logPath
    })
    log.info(`Update ${version} handed to ${path.basename(script)} (elevated: ${elevated})`)
  })
  if (!closing) publish({ phase: 'ready', version })
}

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
  try {
    const tag = await fetchLatestRelease()
    if (generation !== dismissedNoticeGeneration) return
    if (cached && state !== previous) return
    const version = tag.replace(/^v/, '')
    if (!isNewerRelease(version, app.getVersion())) {
      publish({ phase: 'current' })
      return
    }
    publish({ phase: 'available', version })
    if (announceDownload) showDialog(getWindow())
  } catch (error) {
    log.warn('Software update check failed:', error)
    if (generation !== dismissedNoticeGeneration) return
    if (!cached) publish({ phase: 'error', stage: 'check' })
  } finally {
    busy = false
    // An in-flight check discarded by a dismissed notice (or a quick
    // off→on toggle while it ran) leaves the state idle without any check
    // scheduled; run the promised check once notices are back on.
    if (noticesEnabled() && state.phase === 'idle') void runCheck(true, getWindow)
  }
}

const reportFailure = (stage: 'download' | 'install', version: string, error: unknown): void => {
  log.warn(`Software update ${stage} failed:`, error)
  const reported = stage === 'download' && isLocalFileError(error) ? 'prepare' : stage
  publish({ phase: 'error', stage: reported, version })
}

ipcMain.on('mt::update-download', (_event, version: string) => {
  if (!onlineUpdatesEnabled()) return
  if (state.phase !== 'available' || state.version !== version) return
  if (busy || downloadAbort) return
  if (!canInstallInPlace()) {
    publish({ phase: 'error', stage: 'download', version })
    return
  }
  void downloadRelease(version).catch(error => reportFailure('download', version, error))
})

ipcMain.on('mt::update-cancel', () => {
  downloadAbort?.abort()
})

ipcMain.on('mt::update-install', (_event, version: string) => {
  if (!onlineUpdatesEnabled()) return
  if (state.phase !== 'ready' && (state.phase !== 'error' || state.stage !== 'install')) return
  if (state.version !== version) return
  void applyUpdate(version).catch(error => reportFailure('install', version, error))
})

ipcMain.on('mt::update-background', () => {
  announceDownload = false
  pendingDialog = undefined
})

const handlePreferenceChange = (patch: Record<string, unknown>): void => {
  const windowGetter = getActiveWindow ?? (() => null)
  if ('checkUpdatesOnStartup' in patch) {
    if (!noticesEnabled()) {
      announceDownload = false
      pendingDialog = undefined
      dismissedNoticeGeneration += 1
      if (state.phase !== 'idle' && state.phase !== 'downloading' && state.phase !== 'installing') {
        publish({ phase: 'idle' })
      }
    } else if (!busy && state.phase === 'idle') {
      void runCheck(true, windowGetter)
    }
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
  getPreferences?: (() => PreferenceReader | null) | null,
  requestQuit?: (launchInstaller: () => Promise<void>) => Promise<boolean>
): void => {
  getActiveWindow = getWindow
  readPreferences = getPreferences ?? null
  quitForUpdate = requestQuit
  // Only one silent check on startup; further checks are explicitly requested
  // from settings or through the update menu.
  if (startupCheckDone || !canCheckForUpdates()) return
  startupCheckDone = true
  void runCheck(true, getWindow)
}
