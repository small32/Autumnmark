import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.hoisted(() => {
  const w = globalThis as unknown as { window?: Record<string, unknown> }
  w.window ??= {}
  w.window.electron ??= {
    ipcRenderer: {
      on: vi.fn(() => vi.fn()),
      send: vi.fn(),
      invoke: vi.fn(async() => undefined)
    }
  }
})

import { useAutoUpdatesStore } from '@/store/autoUpdates'
import { usePreferencesStore } from '@/store/preferences'
import { GITHUB_REPO_URL } from '@shared/brand'

const send = (): ReturnType<typeof vi.fn> => window.electron.ipcRenderer.send as unknown as ReturnType<typeof vi.fn>

describe('auto update preferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('hides update UI and skips in-app install when notices or online updates are off', async() => {
    const preferences = usePreferencesStore()
    const updates = useAutoUpdatesStore()
    preferences.checkUpdatesOnStartup = false
    preferences.onlineUpdateEnabled = false
    updates.state = { phase: 'available', version: '1.2.3' }
    await nextTick()

    expect(updates.showProgressButton).toBe(false)
    expect(send()).toHaveBeenCalledWith('mt::update-background')

    updates.install()
    expect(send()).not.toHaveBeenCalledWith('mt::update-install', '1.2.3')
  })

  it('opens the matching GitHub Release page', () => {
    const updates = useAutoUpdatesStore()
    updates.state = { phase: 'available', version: '1.2.3' }

    updates.openRelease()
    expect(send()).toHaveBeenCalledWith(
      'mt::shell::open-external',
      `${GITHUB_REPO_URL}/releases/tag/v1.2.3`
    )
  })
})
