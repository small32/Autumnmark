import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock('node:child_process', () => ({ spawn }))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.8',
    getAppPath: () => 'C:\\Apps\\AutumnMark+\\resources\\app.asar',
    getPath: () => os.tmpdir()
  },
  net: {}
}))

import { launchApplyScript } from '../../../src/main/inPlaceUpdate'

describe('Windows update launcher', () => {
  it('hands the script to Start-Process instead of a detached shell', async() => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autumnmark-launch-'))
    try {
      spawn.mockClear()
      spawn.mockImplementation(() => {
        const child = new EventEmitter()
        queueMicrotask(() => child.emit('exit', 0))
        return child
      })
      const elevatedPath = path.join(root, 'target')
      await fs.mkdir(elevatedPath, { recursive: true })
      const request = {
        script: path.join(root, 'run', 'apply-update.ps1'),
        source: path.join(root, 'staging'),
        target: elevatedPath,
        launch: path.join(elevatedPath, 'AutumnMark+.exe'),
        mode: 'dir' as const,
        cleanup: path.join(root, 'attempt-1'),
        logPath: path.join(root, 'update.log')
      }
      await launchApplyScript(request)

      expect(spawn).toHaveBeenCalledTimes(1)
      const [command, args, options] = spawn.mock.calls[0]
      expect(command).toBe('powershell')
      expect(args[0]).toBe('-NoProfile')
      expect(args).toContain('-Command')
      expect(args[3]).toContain('Start-Process')
      expect(args[3]).toContain("-FilePath 'powershell.exe'")
      expect(args[3]).toContain('-WindowStyle Hidden')
      expect(args[3]).not.toContain('-Verb RunAs')
      expect(options).not.toHaveProperty('detached')
      spawn.mockImplementation(() => {
        const child = new EventEmitter()
        queueMicrotask(() => child.emit('exit', 1))
        return child
      })
      await expect(launchApplyScript(request)).rejects.toThrow('powershell exited with 1')
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('macOS update launcher', () => {
  it('waits for authorization and leaves the PID wait to the background helper', async() => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    const access = vi.spyOn(fs, 'access').mockRejectedValue(new Error('Requires administrator'))
    const child = new EventEmitter()
    spawn.mockClear()
    spawn.mockReturnValue(child)
    try {
      const result = launchApplyScript({
        script: '/tmp/staged update/run/apply-update.sh',
        source: '/tmp/staged update/staging/AutumnMark+.app',
        target: '/Applications/AutumnMark+.app',
        launch: '/Applications/AutumnMark+.app',
        mode: 'app',
        cleanup: '/tmp/staged update',
        logPath: '/tmp/update.log'
      })
      const resolved = vi.fn()
      void result.then(resolved, () => {})
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
      const [command, args] = spawn.mock.calls[0]
      expect(command).toBe('osascript')
      expect(args[1]).toContain("/usr/bin/nohup /bin/bash '/tmp/staged update/run/apply-update.sh'")
      expect(args[1]).toContain('</dev/null >/dev/null 2>&1 &')
      expect(args[1]).toContain('with administrator privileges')
      child.emit('spawn')
      await Promise.resolve()
      expect(resolved).not.toHaveBeenCalled()
      child.emit('exit', 1)
      await expect(result).rejects.toThrow('osascript exited with 1')
    } finally {
      access.mockRestore()
      if (platform) Object.defineProperty(process, 'platform', platform)
    }
  })
})
