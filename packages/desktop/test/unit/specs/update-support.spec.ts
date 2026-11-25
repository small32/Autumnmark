import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Set<string>())
vi.mock('common/filesystem', () => ({ isFile: (pathname: string) => files.has(pathname) }))
import { canCheckForUpdates, isUpdatable } from '../../../src/main/utils/isUpdatable'

describe('installed update support', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

  beforeEach(() => {
    files.clear()
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/app/resources' })
  })

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform)
    if (resourcesPath) Object.defineProperty(process, 'resourcesPath', resourcesPath)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs()
  })

  it('enables a Windows installation only when update metadata and its marker exist', () => {
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    expect(isUpdatable()).toBe(false)
    files.add(path.join(process.resourcesPath, 'nsis-installed'))
    expect(isUpdatable()).toBe(true)
    files.delete(path.join(process.resourcesPath, 'app-update.yml'))
    expect(isUpdatable()).toBe(false)
  })

  it('does not mistake bundled file-association icons for an installed application', () => {
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    files.add(path.join(process.resourcesPath, 'md.ico'))
    files.add(path.join(process.resourcesPath, 'icons', 'md.ico'))
    expect(isUpdatable()).toBe(false)
  })

  it('lets packaged builds check for releases even when they cannot install them', () => {
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    // A portable ZIP: metadata exists but the install marker does not.
    expect(isUpdatable()).toBe(false)
    expect(canCheckForUpdates()).toBe(true)
  })

  it('does not check for releases while running unpackaged', () => {
    Object.defineProperty(process, 'defaultApp', { configurable: true, value: true })
    try {
      expect(canCheckForUpdates()).toBe(false)
    } finally {
      Reflect.deleteProperty(process, 'defaultApp')
    }
  })
})
