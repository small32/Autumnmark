import path from 'node:path'
import { expect, it, vi } from 'vitest'

const { app } = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => name === 'appData' ? '/profiles' : '/profiles/marktext'),
    setName: vi.fn(),
    setPath: vi.fn(),
    getAppPath: () => '/app'
  }
}))
vi.mock('electron', () => ({ app }))
vi.mock('common/i18n', () => ({ setLocalesDirectory: vi.fn() }))

it('sets the default Antumnmark+ profile alongside the upstream profile', async() => {
  await import('../../../src/main/globalSetting')
  expect(app.setName).toHaveBeenCalledWith('Antumnmark+')
  expect(app.setPath).toHaveBeenCalledWith('userData', path.join('/profiles', 'autumnmark'))
})
