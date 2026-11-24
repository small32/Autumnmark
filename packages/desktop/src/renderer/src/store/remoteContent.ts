import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { RemoteContentKind, RemoteContentSnapshot } from '@shared/types/ipc'

export const useRemoteContentStore = defineStore('remoteContent', () => {
  const snapshots = reactive<Partial<Record<RemoteContentKind, RemoteContentSnapshot>>>({})
  const loading = reactive({ about: false })

  const refresh = async(kind: RemoteContentKind, force: boolean): Promise<void> => {
    if (loading[kind]) return
    loading[kind] = true
    try {
      snapshots[kind] = await window.electron.ipcRenderer.invoke('mt::remote-content::fetch', kind, force)
    } catch {
      snapshots[kind] = { ...snapshots[kind], content: snapshots[kind]?.content ?? null, status: 'failed' }
    } finally {
      loading[kind] = false
    }
  }

  return { snapshots, loading, refresh }
})
