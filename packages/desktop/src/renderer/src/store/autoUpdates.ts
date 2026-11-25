import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { t } from '@/i18n'
import { GITHUB_REPO_URL } from '@shared/brand'
import { usePreferencesStore } from './preferences'
import type { UpdateState } from '@shared/types/ipc'

export const useAutoUpdatesStore = defineStore('autoUpdates', () => {
  const preferences = usePreferencesStore()
  const state = ref<UpdateState>({ phase: 'idle' })
  const visible = ref(false)
  const noticesEnabled = computed(() => preferences.checkUpdatesOnStartup !== false)
  const onlineEnabled = computed(() => preferences.onlineUpdateEnabled !== false)
  const releaseVersion = computed(() => 'version' in state.value ? state.value.version : null)
  const releaseUrl = computed(() => releaseVersion.value
    ? `${GITHUB_REPO_URL}/releases/tag/v${releaseVersion.value}`
    : `${GITHUB_REPO_URL}/releases/latest`)
  const showProgressButton = computed(() => noticesEnabled.value && (
    state.value.phase === 'checking' || 'version' in state.value
  ))
  const progress = computed(() => state.value.phase === 'downloading' ? state.value.progress : null)
  const percent = computed(() => {
    const download = progress.value
    if (!download || download.total <= 0) return null
    return Math.min(100, Math.floor(100 * download.transferred / download.total))
  })
  const status = computed(() => {
    const s = state.value
    switch (s.phase) {
      case 'checking': return t('updates.checking')
      case 'available': return t('updates.available', { version: s.version })
      case 'downloading': return percent.value === 100
        ? t('updates.preparing', { version: s.version })
        : t('updates.downloading', { version: s.version })
      case 'ready': return t('updates.ready', { version: s.version })
      case 'installing': return t('updates.downloaded')
      case 'current': return t('updates.upToDate')
      case 'error': return t({ check: 'updates.checkFailed', download: 'updates.downloadFailed', prepare: 'updates.prepareFailed', install: 'updates.installFailed' }[s.stage])
      default: return ''
    }
  })

  watch(noticesEnabled, (enabled) => {
    if (enabled) return
    visible.value = false
    window.electron.ipcRenderer.send('mt::update-background')
  })

  function listen(): () => void {
    const ipc = window.electron.ipcRenderer
    const off = ipc.on('mt::update-state', (_event, next, show) => {
      state.value = next
      if (show && noticesEnabled.value) visible.value = true
    })
    ipc.send('mt::update-listen')
    return off
  }

  function hide(): void {
    if (!visible.value) return
    visible.value = false
    window.electron.ipcRenderer.send('mt::update-background')
  }

  function retry(): void {
    window.electron.ipcRenderer.send('mt::check-for-update')
  }

  function install(): void {
    if (!onlineEnabled.value) return
    if ('version' in state.value && state.value.version) {
      window.electron.ipcRenderer.send('mt::update-install', state.value.version)
    }
  }

  function download(): void {
    if (!onlineEnabled.value) return
    if (state.value.phase !== 'available') return
    window.electron.ipcRenderer.send('mt::update-download', state.value.version)
  }

  function cancel(): void {
    window.electron.ipcRenderer.send('mt::update-cancel')
  }

  function openRelease(): void {
    window.electron.ipcRenderer.send('mt::shell::open-external', releaseUrl.value)
  }

  return {
    state, progress, percent, status, showProgressButton, visible,
    noticesEnabled, onlineEnabled, releaseVersion, releaseUrl,
    listen, hide, retry, install, download, cancel, openRelease
  }
})
