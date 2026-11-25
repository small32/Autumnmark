import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn(
    (_command: string, _args: string[], _options: Record<string, unknown>) => ({ unref: vi.fn() })
  )
}))

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
      const elevatedPath = path.join(root, 'target')
      await fs.mkdir(elevatedPath, { recursive: true })
      await launchApplyScript({
        script: path.join(root, 'run', 'apply-update.ps1'),
        source: path.join(root, 'staging'),
        target: elevatedPath,
        launch: path.join(elevatedPath, 'AutumnMark+.exe'),
        mode: 'dir',
        cleanup: path.join(root, 'attempt-1'),
        logPath: path.join(root, 'update.log')
      })

      expect(spawn).toHaveBeenCalledTimes(1)
      const [command, args, options] = spawn.mock.calls[0]
      expect(command).toBe('powershell')
      expect(args[0]).toBe('-NoProfile')
      expect(args).toContain('-Command')
      expect(args[3]).toContain('Start-Process')
      expect(args[3]).toContain("-FilePath 'powershell.exe'")
      expect(args[3]).toContain('-WindowStyle Hidden')
      expect(args[3]).not.toContain('-Verb RunAs')
      // The broken path used a detached PowerShell that could exit before the
      // -File script ran. The launcher stays attached but unref'd.
      expect(options).not.toHaveProperty('detached')
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform)
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
