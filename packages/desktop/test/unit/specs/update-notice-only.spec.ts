import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain, type BrowserWindow } from 'electron'
import type * as DesktopUpdates from '../../../src/main/updates'
import type * as InPlaceUpdate from '../../../src/main/inPlaceUpdate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Portable ZIPs cannot install updates, but they must still learn that a newer
// release exists.
const { isUpdatable, netFetch, updater } = vi.hoisted(() => ({
  isUpdatable: vi.fn(),
  netFetch: vi.fn(),
  updater: {
    createUpdateAttemptDirectory: vi.fn(),
    resolveReleaseAssets: vi.fn(),
    downloadFile: vi.fn(),
    verifyChecksum: vi.fn(),
    extractArchive: vi.fn(),
    resolveInstallTarget: vi.fn(),
    resolveApplyScript: vi.fn(),
    launchApplyScript: vi.fn()
  }
}))
vi.mock('../../../src/main/inPlaceUpdate', async(importOriginal) => ({
  ...await importOriginal<typeof InPlaceUpdate>(),
  ...updater
}))
vi.mock('electron', async() => {
  const { EventEmitter } = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), { getVersion: () => '0.1.3', getPath: () => tmpdir() }),
    ipcMain: new EventEmitter(),
    BrowserWindow: {},
    net: { fetch: netFetch }
  }
})
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
vi.mock('../../../src/main/utils/isUpdatable', () => ({
  isUpdatable,
  canCheckForUpdates: () => true,
  canInstallInPlace: () => true
}))

const send = vi.fn()
const sender = Object.assign(new EventEmitter(), { send })
const win = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow
const listen = (): void => { ipcMain.emit('mt::update-listen', { sender }) }
const release = (tag: string): Response =>
  new Response(JSON.stringify({ tag_name: tag }), { status: 200, headers: { 'content-type': 'application/json' } })

let updates: typeof DesktopUpdates

describe('release-only update checks', () => {
  beforeEach(async() => {
    vi.resetModules()
    vi.resetAllMocks()
    ipcMain.removeAllListeners()
    sender.removeAllListeners()
    isUpdatable.mockReturnValue(false)
    netFetch.mockImplementation(async() => release('v0.1.3'))
    updates = await import('../../../src/main/updates')
    listen()
    send.mockClear()
  })

  it('reports a newer release without touching the updater or the filesystem', async() => {
    netFetch.mockImplementation(async() => release('v0.2.0'))
    // The startup check is the path that shows an unsolicited notice.
    updates.startAutomaticUpdateChecks(() => win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' }, true)
    })
  })

  it('reports the current version when the latest release is not newer', async() => {
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'current' })
    })
  })

  it('ignores a release tag that cannot be compared', async() => {
    netFetch.mockImplementation(async() => release('nightly'))
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'current' })
    })
  })

  it('reports a check error when GitHub is unreachable', async() => {
    netFetch.mockImplementation(async() => { throw new Error('offline') })
    updates.checkUpdates(win)
    // Network errors are retried with a short backoff before giving up.
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    }, { timeout: 8000 })
  })

  it('retries a transient network failure instead of reporting it', async() => {
    let attempts = 0
    netFetch.mockImplementation(async() => {
      attempts += 1
      if (attempts === 1) throw new Error('fetch failed')
      return release('v0.2.0')
    })
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' })
    }, { timeout: 8000 })
    expect(attempts).toBe(2)
  })

  it('reports a check error when GitHub returns a non-OK status', async() => {
    netFetch.mockImplementation(async() => new Response('rate limited', { status: 403 }))
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    })
  })

  it('checks once on startup and does not repeat', async() => {
    updates.startAutomaticUpdateChecks(() => win)
    updates.startAutomaticUpdateChecks(() => win)
    await vi.waitFor(() => {
      expect(netFetch).toHaveBeenCalledOnce()
    })
  })

  it('skips the startup check when notices are disabled but still answers a manual check', async() => {
    const preferences = { getItem: vi.fn((key: string) => key === 'checkUpdatesOnStartup' ? false : true) }
    updates.startAutomaticUpdateChecks(() => win, () => preferences)
    await Promise.resolve()
    expect(netFetch).not.toHaveBeenCalled()

    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(netFetch).toHaveBeenCalledOnce()
    })
    // A manual check never opens a dialog while notices are off.
    expect(send.mock.calls.some(call => call[2] === true)).toBe(false)
  })

  it('announces a new release once and keeps the notice after a background dismissal', async() => {
    netFetch.mockImplementation(async() => release('v0.2.0'))
    updates.startAutomaticUpdateChecks(() => win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' }, true)
    })
    send.mockClear()

    // Re-checking the same release must not re-open the dialog on its own.
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(netFetch).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls.filter(call => call[2] === true)).toHaveLength(1)
  })

  it('retries a failed check', async() => {
    netFetch.mockImplementation(async() => { throw new Error('offline') })
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    }, { timeout: 8000 })

    netFetch.mockImplementation(async() => release('v0.2.0'))
    updates.checkUpdates(win)
    await vi.waitFor(() => {
      // A manual check reports the version without an unsolicited notice.
      expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '0.2.0' })
    })
  })

  it('starts the staged installer only after clean shutdown is accepted', async() => {
    const directory = await mkdtemp(join(tmpdir(), 'autumnmark-update-cancel-'))
    const version = '0.2.0'
    const ready = { phase: 'ready', version }
    try {
      const script = join(directory, 'apply-update.ps1')
      await writeFile(script, '')
      updater.createUpdateAttemptDirectory.mockResolvedValue(directory)
      updater.resolveReleaseAssets.mockReturnValue([
        { name: 'archive.zip', url: 'archive' }, { name: 'SHA256SUMS.txt', url: 'checksums' }
      ])
      updater.downloadFile.mockImplementation(async(url, destination) => {
        await writeFile(destination, url === 'checksums' ? 'a'.repeat(64) + '  archive.zip\n' : '')
      })
      updater.resolveInstallTarget.mockReturnValue({ mode: 'dir', target: directory, launch: script })
      updater.resolveApplyScript.mockResolvedValue(script)
      updater.launchApplyScript.mockRejectedValueOnce(new Error('Could not launch'))
      updater.launchApplyScript.mockResolvedValueOnce({ elevated: false })
      const quit = vi.fn(async(install: () => Promise<void>) => {
        await install()
        return true
      }).mockResolvedValueOnce(false)
      netFetch.mockImplementation(async() => release('v' + version))
      updates.startAutomaticUpdateChecks(() => win, null, quit)
      await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version }, true))
      ipcMain.emit('mt::update-download', { sender }, version)
      await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith('mt::update-state', ready, true))

      ipcMain.emit('mt::update-install', { sender }, version)
      await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith('mt::update-state', ready))
      expect(quit).toHaveBeenCalledOnce()
      expect(updater.launchApplyScript).not.toHaveBeenCalled()

      ipcMain.emit('mt::update-install', { sender }, version)
      await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'install', version }))
      ipcMain.emit('mt::update-install', { sender }, version)
      await vi.waitFor(() => expect(updater.launchApplyScript).toHaveBeenCalledTimes(2))
      expect(quit).toHaveBeenCalledTimes(3)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
