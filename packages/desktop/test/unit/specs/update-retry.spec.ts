import { EventEmitter } from 'node:events'
import { ipcMain, type BrowserWindow } from 'electron'
import type * as DesktopUpdates from '../../../src/main/updates'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const interval = 20 * 60 * 1000
const send = vi.fn()
const sender = Object.assign(new EventEmitter(), { send })
const win = { isDestroyed: () => false, webContents: sender } as unknown as BrowserWindow
const available = (version: string) => ({ isUpdateAvailable: true, updateInfo: { version } })
const listen = (): void => { ipcMain.emit('mt::update-listen', { sender }) }
let updates: typeof DesktopUpdates
const updaterEvents = new EventEmitter()

describe('desktop updates', () => {
  beforeEach(async() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.resetAllMocks()
    ipcMain.removeAllListeners()
    sender.removeAllListeners()
    updaterEvents.removeAllListeners()
    updater.on.mockImplementation((event, callback) => updaterEvents.on(event, callback))
    isUpdatable.mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn(async() => new Response(JSON.stringify({ tag_name: 'v0.1.3' }), { status: 200 })))
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false })
    updater.downloadUpdate.mockResolvedValue([])
    updates = await import('../../../src/main/updates')
    listen()
    send.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prefetches stable releases without installing on normal exit', () => {
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.autoDownload).toBe(false)
  })

  it('checks only once on startup and never repeats on a timer', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    updates.startAutomaticUpdateChecks(() => win)
    updates.startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(interval * 2)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(send.mock.calls.some(call => call[2] === true)).toBe(false)
  })

  it('never asks the installer to check for updates on unsupported installations', async() => {
    isUpdatable.mockReturnValue(false)
    updates.startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(interval)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('skips automatic checks when update notices are disabled', async() => {
    const preferences = { getItem: vi.fn((key: string) => key === 'checkUpdatesOnStartup' ? false : true) }
    updates.startAutomaticUpdateChecks(() => win, () => preferences)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(interval)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalledWith('mt::update-state', expect.anything(), true)

    // An explicit check still works; only the automatic notice is suppressed.
    updates.checkUpdates(win)
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('reports available releases without downloading when online updates are disabled', async() => {
    updater.checkForUpdates.mockResolvedValue(available('2.0'))
    const preferences = { getItem: vi.fn((key: string) => key === 'onlineUpdateEnabled' ? false : true) }
    updates.startAutomaticUpdateChecks(() => win, () => preferences)
    await vi.advanceTimersByTimeAsync(0)

    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'available', version: '2.0' }, true)
    ipcMain.emit('mt::update-install', { sender }, '2.0')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('does not let an in-flight check restore a notice dismissed in settings', async() => {
    let notices = true
    const preferences = { getItem: vi.fn((key: string) => key === 'checkUpdatesOnStartup' ? notices : true) }
    updates.startAutomaticUpdateChecks(() => win, () => preferences)
    await vi.advanceTimersByTimeAsync(0)
    send.mockClear()

    updater.checkForUpdates.mockImplementationOnce(() =>
      new Promise(resolve => setTimeout(() => resolve({ isUpdateAvailable: false }), 5)))
    updates.checkUpdates(win)
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'checking' }, true)

    notices = false
    ipcMain.emit('broadcast-preferences-changed', { checkUpdatesOnStartup: false })
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'idle' })
    send.mockClear()

    await vi.advanceTimersByTimeAsync(10)
    expect(send).not.toHaveBeenCalled()
  })

  it('shows an ongoing check immediately and allows retry after a network error', async() => {
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    updates.startAutomaticUpdateChecks(() => win)
    updates.checkUpdates(win)
    expect(send).toHaveBeenCalledWith('mt::update-state', { phase: 'checking' }, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'check' })
    updates.checkUpdates(win)
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'current' })
  })

  it('shares live progress with manual checks and newly opened windows', async() => {
    updater.checkForUpdates.mockResolvedValue(available('1.1'))
    updater.downloadUpdate.mockImplementation(() => new Promise(resolve => setTimeout(resolve, interval + 1)))
    updates.startAutomaticUpdateChecks(() => win)
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(send.mock.calls.some(call => call[2] === true)).toBe(false)

    const progress = { transferred: 20, total: 100, bytesPerSecond: 7 }
    updaterEvents.emit('download-progress', progress)
    const downloading = { phase: 'downloading', version: '1.1', progress }
    updates.checkUpdates(win)
    expect(send).toHaveBeenLastCalledWith('mt::update-state', downloading, true)
    const second = Object.assign(new EventEmitter(), { send: vi.fn() })
    ipcMain.emit('mt::update-listen', { sender: second })
    expect(second.send).toHaveBeenCalledWith('mt::update-state', downloading, false)
    ipcMain.emit('mt::update-background', { sender })
    await vi.advanceTimersByTimeAsync(interval + 1)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'ready', version: '1.1' })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('offers a prefetched version once, even when the renderer starts after the download', async() => {
    sender.emit('destroyed')
    updater.checkForUpdates.mockResolvedValue(available('1.2'))
    updates.startAutomaticUpdateChecks(() => null)
    await vi.advanceTimersByTimeAsync(0)
    listen()
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'ready', version: '1.2' }, true)
    send.mockClear()
    await vi.advanceTimersByTimeAsync(interval)
    expect(send).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('allows retry after a failed download and installs only the confirmed, ready version', async() => {
    updater.checkForUpdates.mockResolvedValue(available('1.4'))
    updater.downloadUpdate.mockRejectedValueOnce(new Error('connection reset'))
    updates.checkUpdates(win)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'download', version: '1.4' })
    ipcMain.emit('mt::update-install', { sender }, '1.4')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    updates.checkUpdates(win)
    await vi.advanceTimersByTimeAsync(0)
    ipcMain.emit('mt::update-install', { sender }, '1.3')
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    ipcMain.emit('mt::update-install', { sender }, '1.4')
    ipcMain.emit('mt::update-install', { sender }, '1.4')
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    updaterEvents.emit('error', new Error('installer failed'))
    expect(send).toHaveBeenLastCalledWith('mt::update-state', { phase: 'error', stage: 'install', version: '1.4' })
    ipcMain.emit('mt::update-install', { sender }, '1.4')
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
  })
})
