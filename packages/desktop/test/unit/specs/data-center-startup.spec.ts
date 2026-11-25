// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { emit, on, environment } = vi.hoisted(() => ({ emit: vi.fn(), on: vi.fn(), environment: { directory: '' } }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getVersion: () => '0.24.0' },
  ipcMain: { on, handle: vi.fn(), emit },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() }
}))
vi.mock('keytar', () => ({ default: { getPassword: vi.fn(), setPassword: vi.fn() } }))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), warn: vi.fn() } }))

vi.mock('electron-store', async() => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const confPath = require.resolve('conf', { paths: [require.resolve('electron-store')] })
  const { default: Conf } = await import(confPath)
  return {
    default: class extends Conf {
      constructor(options: Record<string, unknown>) {
        super({ cwd: environment.directory, configName: 'dataCenter', ...options })
      }
    }
  }
})

const { default: DataCenter } = await import('main_renderer/dataCenter')
const profiles: string[] = []
const profile = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'mt-data-center-'))
  profiles.push(directory)
  environment.directory = directory
  return directory
}
afterEach(() => {
  profiles.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  emit.mockClear()
})

describe('DataCenter startup isolation', () => {
  it.each(['{broken', '[]', 'null', JSON.stringify({ imageFolderPath: 123 })])(
    'uses read-only defaults and preserves unavailable storage: %s',
    async(input) => {
      const directory = profile()
      const pathname = join(directory, 'dataCenter.json')
      writeFileSync(pathname, input)
      const dataCenter = new DataCenter({ dataCenterPath: directory, userDataPath: directory })
      expect(await dataCenter.getAll()).toMatchObject({
        imageFolderPath: join(directory, 'images'),
        screenshotFolderPath: join(directory, 'screenshot'),
        webImages: [],
        cloudImages: [],
        currentUploader: 'picgo'
      })
      expect(await dataCenter.getItem('screenshotFolderPath')).toBe(join(directory, 'screenshot'))
      const first = await dataCenter.getAll()
      const images = first.webImages as unknown[]
      images.push('mutation')
      expect((await dataCenter.getAll()).webImages).toEqual([])
      await dataCenter.setItem('imageFolderPath', '/replacement')
      expect(readFileSync(pathname, 'utf8')).toBe(input)
      expect(emit).not.toHaveBeenCalled()
    }
  )

  it('keeps an unreadable path intact and continues with defaults', async() => {
    const directory = profile()
    mkdirSync(join(directory, 'dataCenter.json'))
    const dataCenter = new DataCenter({ dataCenterPath: directory, userDataPath: directory })
    expect(await dataCenter.getItem('webImages')).toEqual([])
  })

  it('persists defaults and creates the screenshot directory on a fresh profile', async() => {
    const directory = profile()
    const dataCenter = new DataCenter({ dataCenterPath: directory, userDataPath: directory })
    expect(JSON.parse(readFileSync(join(directory, 'dataCenter.json'), 'utf8'))).toMatchObject(
      await dataCenter.getAll()
    )
    expect(await dataCenter.getItem('currentUploader')).toBe('picgo')
    expect(statSync(join(directory, 'screenshot')).isDirectory()).toBe(true)
  })

  it('restricts mt::set-user-data writes to the uploader settings keys', async() => {
    const directory = profile()
    const dataCenter = new DataCenter({ dataCenterPath: directory, userDataPath: directory })
    const handler = on.mock.calls.find(([channel]) => channel === 'mt::set-user-data')?.[1] as
      | ((event: unknown, userData: Record<string, unknown>) => void)
      | undefined
    if (!handler) throw new Error('mt::set-user-data handler was not registered')

    handler({}, {
      cliScript: '/usr/local/bin/upload',
      currentUploader: 'cliScript',
      webImages: ['injected'],
      imageFolderPath: '/tmp/injected'
    })

    expect(await dataCenter.getItem('cliScript')).toBe('/usr/local/bin/upload')
    expect(await dataCenter.getItem('currentUploader')).toBe('cliScript')
    expect(await dataCenter.getItem('webImages')).toEqual([])
    expect(await dataCenter.getItem('imageFolderPath')).toBe(join(directory, 'images'))
  })

  it('persists only the path argument for set-image-folder-path', async() => {
    const directory = profile()
    const dataCenter = new DataCenter({ dataCenterPath: directory, userDataPath: directory })
    const handler = on.mock.calls.find(([channel]) => channel === 'set-image-folder-path')?.[1] as
      | ((event: unknown, newPath?: unknown) => void)
      | undefined
    if (!handler) throw new Error('set-image-folder-path handler was not registered')

    handler({}, '/custom/images')
    expect(await dataCenter.getItem('imageFolderPath')).toBe('/custom/images')

    // The legacy single-argument signature used to persist the IpcEvent itself.
    handler('not-an-event')
    expect(await dataCenter.getItem('imageFolderPath')).toBe('/custom/images')
  })

  it('retains valid values and unknown keys while persisting normal updates', async() => {
    const directory = profile()
    const pathname = join(directory, 'dataCenter.json')
    writeFileSync(
      pathname,
      JSON.stringify({ imageFolderPath: '/custom/images', legacy: { retained: true } })
    )
    const dataCenter = new DataCenter({ dataCenterPath: directory, userDataPath: directory })
    expect(await dataCenter.getItem('imageFolderPath')).toBe('/custom/images')
    expect(await dataCenter.getItem('cloudImages')).toEqual([])
    await dataCenter.setItem('currentUploader', 'picgo')
    expect(JSON.parse(readFileSync(pathname, 'utf8'))).toMatchObject({
      imageFolderPath: '/custom/images',
      legacy: { retained: true },
      currentUploader: 'picgo'
    })
    expect(emit).toHaveBeenCalledWith('broadcast-user-data-changed', { currentUploader: 'picgo' })
  })
})
