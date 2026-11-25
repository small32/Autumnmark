<template>
  <theme-history-dialog
    :name="name"
    :entries="history?.entries ?? []"
    :current="history?.current ?? emptySnapshot"
    :failed="failed"
    :restoring="restoring"
    :empty="!!history && !history.entries.length"
    :error="error"
    :preferred-type="preferredType"
    :document-history="{ entries: documents ?? [], loading: documents === undefined, failed: documentsFailed }"
    applied
    @close="emit('close')"
    @restore="restore"
    @conversation="(chatId, turnId) => emit('conversation', chatId, turnId)"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DocumentChatHistoryEntry, DocumentChatTarget } from '@shared/documentChat'
import type { AppliedThemeHistory, ThemeSnapshot, ThemeVersion } from '@shared/themeVersion'
import ThemeHistoryDialog from '@/prefComponents/theme/themeHistoryDialog.vue'
import { themeLabel } from '@/prefComponents/theme/config'

const props = defineProps<{ preferredType: 'document' | 'theme'; target?: DocumentChatTarget }>()
const emit = defineEmits<{ close: []; conversation: [chatId: string, turnId: string] }>()
const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const emptySnapshot: ThemeSnapshot = { name: '', base: 'light', css: '', sample: null }
const history = shallowRef<AppliedThemeHistory>()
const failed = ref(false)
const restoring = ref(false)
const error = ref('')
const documents = shallowRef<DocumentChatHistoryEntry[]>()
const documentsFailed = ref(false)
let documentLoadId = 0
const name = computed(() => {
  const current = history.value
  if (!current) return ''
  return current.themeId.startsWith('local:') ? current.current.name : themeLabel(current.themeId)
})

async function load(): Promise<void> {
  failed.value = false
  try { history.value = await ipc.invoke('mt::theme::active-history') }
  catch { failed.value = true }
}

async function loadDocuments(): Promise<void> {
  const loadId = ++documentLoadId
  const target = props.target
  documentsFailed.value = false
  try {
    const records = await ipc.invoke('mt::document-chat::history', target && { id: target.id, pathname: target.pathname })
    if (loadId === documentLoadId) documents.value = records
  } catch {
    if (loadId === documentLoadId) documentsFailed.value = true
  }
}

async function restore(version: ThemeVersion): Promise<void> {
  const current = history.value
  if (!current || restoring.value || failed.value) return
  restoring.value = true
  error.value = ''
  try {
    const result = await ipc.invoke('mt::theme::restore-active-version', current.themeId, current.revision, version.revision)
    if (result) history.value = result
    else {
      await load()
      if (!failed.value) error.value = t('themeAi.changed')
    }
  } catch { error.value = t('themeHistory.storageError') }
  finally { restoring.value = false }
}

watch([() => props.target?.id, () => props.target?.pathname], () => {
  documents.value = undefined
  void loadDocuments()
}, { immediate: true })
const stopHistory = ipc.on('mt::document-chat::changed', () => { void loadDocuments() })
onMounted(load)
onUnmounted(() => {
  documentLoadId++
  stopHistory()
})
</script>
