import { EventEmitter } from 'node:events'
import { ipcMain, type BrowserWindow } from 'electron'
import type * as DesktopUpdates from '../../../src/main/updates'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Portable ZIPs, unsigned macOS builds and non-AppImage Linux packages cannot
// install updates, but they must still learn that a newer release exists.
const { updater, isUpdatable } = vi.hoisted(() => ({
  isUpdatable: vi.fn(),
  updater: {
    allowPrerelease: true,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  }
}))
vi.mock('electron-updater', () => ({ autoUpdater: updater }))
vi.mock('electron', async() => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), { getVersion: () => '0.1.3' }),
    ipcMain: new EventEmitter(),
    BrowserWindow: {}
  }
})
vi.mock('electron-log', () => ({ default: { warn: vi.fn() } }))
vi.mock('../../../src/main/utils/isUpdatable', () => ({ isUpdatable, canCheckForUpdates: () => true }))

const send = vi.fn()
const sender = Object.assign(new EventEmitter(), { send })
const win = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow
const listen = (): void => { ipcMain.emit('mt::update-listen', { sender }) }
const release = (tag: string): Response =>
  new Response(JSON.stringify({ tag_name: tag }), { status: 200, headers: { 'content-type': 'application/json' } })

let updates: typeof DesktopUpdates
let fetchMock: ReturnType<typeof vi.fn>

describe('release-only update checks', () => {
  beforeEach(async() => {
    vi.resetModules()
    vi.resetAllMocks()
    ipcMain.removeAllListeners()
    sender.removeAllListeners()
    isUpdatable.mockReturnValue(false)
    fetchMock = vi.fn(async() => release('v0.1.3'))
    vi.stubGlobal('fetch', fetchMock)
    updates = await import('../../../src/main/updates')
    listen()
    send.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a newer release without touching the updater or the filesystem', async() => {
    fetchMock = vi.fn(async() => release('v0.2.0'))
    vi.stubGlobal('fetch', fetchMock)
    // The startup check is the path that shows an unsolicited notice.
    updates.startAutomaticUpdateChecks(() => win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' }, true)
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('reports the current version when the latest release is not newer', async() => {
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'current' })
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('ignores a release tag that cannot be compared', async() => {
    fetchMock = vi.fn(async() => release('nightly'))
    vi.stubGlobal('fetch', fetchMock)
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'current' })
    })
  })

  it('reports a check error when GitHub is unreachable', async() => {
    fetchMock = vi.fn(async() => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchMock)
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports a check error when GitHub returns a non-OK status', async() => {
    fetchMock = vi.fn(async() => new Response('rate limited', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    })
  })

  it('checks once on startup and does not repeat', async() => {
    updates.startAutomaticUpdateChecks(() => win)
    updates.startAutomaticUpdateChecks(() => win)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })

  it('skips the startup check when notices are disabled but still answers a manual check', async() => {
    const preferences = { getItem: vi.fn((key: string) => key === 'checkUpdatesOnStartup' ? false : true) }
    updates.startAutomaticUpdateChecks(() => win, () => preferences)
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()

    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    // A manual check never opens a dialog while notices are off.
    expect(send.mock.calls.some(call => call[2] === true)).toBe(false)
  })

  it('announces a new release once and keeps the notice after a background dismissal', async() => {
    fetchMock = vi.fn(async() => release('v0.2.0'))
    vi.stubGlobal('fetch', fetchMock)
    updates.startAutomaticUpdateChecks(() => win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' }, true)
    })
    send.mockClear()

    // Re-checking the same release must not re-open the dialog on its own.
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls.filter(call => call[2] === true)).toHaveLength(1)
  })

  it('retries a failed check', async() => {
    fetchMock = vi.fn(async() => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchMock)
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    })

    fetchMock = vi.fn(async() => release('v0.2.0'))
    vi.stubGlobal('fetch', fetchMock)
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      // A manual check reports the version without an unsolicited notice.
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' })
    })
  })
})
