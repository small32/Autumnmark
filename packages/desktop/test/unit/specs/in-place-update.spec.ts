import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.3',
    getAppPath: () => '/Applications/Antumnmark+.app/Contents/Resources/app.asar',
    getPath: () => os.tmpdir()
  }
}))

import {
  parseChecksums, releaseAssetName, resolveInstallTarget, resolveReleaseAssets, verifyChecksum
} from '../../../src/main/inPlaceUpdate'

describe('release assets', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const arch = Object.getOwnPropertyDescriptor(process, 'arch')
  const setPlatform = (value: NodeJS.Platform, cpu: NodeJS.Architecture): void => {
    Object.defineProperty(process, 'platform', { configurable: true, value })
    Object.defineProperty(process, 'arch', { configurable: true, value: cpu })
  }

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform)
    if (arch) Object.defineProperty(process, 'arch', arch)
  })

  it('maps each platform to the archive the release actually ships', () => {
    setPlatform('win32', 'x64')
    expect(releaseAssetName('0.1.4')).toBe('autumnmark-win-x64-0.1.4.zip')
    setPlatform('darwin', 'arm64')
    expect(releaseAssetName('0.1.4')).toBe('autumnmark-mac-arm64-0.1.4.zip')
    setPlatform('linux', 'x64')
    expect(releaseAssetName('0.1.4')).toBe('autumnmark-linux-0.1.4.AppImage')
    // No published artifact for these combinations.
    setPlatform('win32', 'arm64')
    expect(releaseAssetName('0.1.4')).toBeNull()
    expect(resolveReleaseAssets('0.1.4')).toEqual([])
  })

  it('builds versioned download URLs plus the checksum file', () => {
    setPlatform('win32', 'x64')
    const assets = resolveReleaseAssets('0.1.4')
    expect(assets.map(asset => asset.name)).toEqual([
      'autumnmark-win-x64-0.1.4.zip',
      'SHA256SUMS.txt'
    ])
    expect(assets[0].url).toBe(
      'https://github.com/small32/Autumnmark/releases/download/v0.1.4/autumnmark-win-x64-0.1.4.zip'
    )
  })
})

describe('checksums', () => {
  it('parses sha256sum output, including the binary-mode marker', () => {
    const sums = parseChecksums([
      'a'.repeat(64) + '  autumnmark-win-x64-0.1.4.zip',
      'b'.repeat(64) + ' *autumnmark-mac-arm64-0.1.4.zip',
      'not a checksum line'
    ].join('\n'))
    expect(sums.get('autumnmark-win-x64-0.1.4.zip')).toBe('a'.repeat(64))
    expect(sums.get('autumnmark-mac-arm64-0.1.4.zip')).toBe('b'.repeat(64))
    expect(sums.size).toBe(2)
  })

  it('accepts a matching archive and rejects a mismatch', async() => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autumnmark-checksum-'))
    const file = path.join(directory, 'archive.zip')
    try {
      await fs.writeFile(file, 'payload')
      // sha256("payload")
      const expected = '239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5'
      await expect(verifyChecksum(file, expected)).resolves.toBeUndefined()
      await expect(verifyChecksum(file, expected.toUpperCase())).resolves.toBeUndefined()
      await expect(verifyChecksum(file, 'c'.repeat(64))).rejects.toThrow(/checksum/)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})

describe('install target', () => {
  it('replaces the bundle that is currently running on macOS', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    try {
      // Resolve with the host path rules so the assertion also holds on Windows.
      const bundle = path.resolve('/Applications/Antumnmark+.app/Contents/Resources/app.asar', '../../..')
      expect(resolveInstallTarget()).toEqual({ target: bundle, launch: bundle, mode: 'app' })
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform)
    }
  })

  it('refuses to fake an in-place update for a non-AppImage Linux build', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    vi.stubEnv('APPIMAGE', '')
    try {
      expect(() => resolveInstallTarget()).toThrow(/AppImage/)
    } finally {
      vi.unstubAllEnvs()
      if (platform) Object.defineProperty(process, 'platform', platform)
    }
  })
})
