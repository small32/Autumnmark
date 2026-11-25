<template>
  <div class="theme-preview">
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <section
      v-if="draft"
      class="preview-actions"
      :aria-label="t('themeAi.previewStatus')"
    >
      <p role="status">
        {{ t(previewing ? 'themeAi.previewing' : 'themeAi.previewReady') }}
      </p>
      <p
        v-if="cssIssue"
        role="alert"
      >
        {{ t('studio.cssIssue') }} · {{ cssIssue }}
      </p>
      <p
        v-else-if="!source || source.catalog"
        class="copy-hint"
      >
        {{ t('themeAi.copyOnApply') }}
      </p>
      <div>
        <button
          v-if="previewing"
          type="button"
          :disabled="busy"
          @click="endPreview"
        >
          {{ t('themeAi.endPreview') }}
        </button>
        <button
          v-else
          type="button"
          :disabled="!documentId || busy"
          @click="previewHere"
        >
          {{ t('themeAi.previewHere') }}
        </button>
        <button
          type="button"
          :disabled="!previewing || !!cssIssue || busy"
          @click="apply"
        >
          {{ t('themeAi.apply') }}
        </button>
      </div>
    </section>
    <p
      v-else-if="status"
      role="status"
    >
      {{ status }}
    </p>
    <theme-history-dialog
      v-if="historyOpen"
      :name="snapshot.name"
      :entries="entries"
      :current="snapshot"
      :failed="versionFailed"
      :restoring="busy"
      :initial-version="chosenVersion"
      @close="closeHistory"
      @restore="restore"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DocumentChatThemeContext, DocumentChatThemeEffect, DocumentChatThemeProposal } from '@shared/documentChat'
import type { LocalTheme } from '@shared/localTheme'
import { sameThemeSnapshot, type ThemeSnapshot } from '@shared/themeVersion'
import { themeCssIssue } from '@shared/themeCss'
import { builtinThemeCss } from '@/util/builtinTheme'
import { localThemeCss } from '@shared/themeOverrides'
import ThemeHistoryDialog from '@/prefComponents/theme/themeHistoryDialog.vue'
import { readDraftSample, readThemeDraft, type ThemeDraftEntry } from '@/prefComponents/theme/themeDrafts'
import { readThemeVersions, type ThemeVersion } from '@/prefComponents/theme/themeVersions'
import { useThemeVersions } from '@/prefComponents/theme/useThemeVersions'

const props = defineProps<{
  sourceId: string
  source: LocalTheme | null
  target: ThemeDraftEntry
  documentId?: string
  pending: boolean
}>()
const emit = defineEmits<{ preview: [theme: LocalTheme | null, documentId?: string] }>()
const { t, locale } = useI18n()
const ipc = window.electron.ipcRenderer
const uuid = props.target.draft.id.split(':')[2]
const versions = useThemeVersions(uuid, false)
const { entries, failed: versionFailed } = versions
const draft = shallowRef<ThemeSnapshot>()
const previewDocument = ref<string>()
const previewing = computed(() => !!draft.value && !!props.documentId && previewDocument.value === props.documentId)
const installed = computed<ThemeSnapshot>(() => ({
  name: props.source?.catalog ? props.target.draft.name : props.source?.name ?? props.target.draft.name,
  base: props.target.draft.base,
  css: localThemeCss(props.source ?? undefined),
  sample: readDraftSample(props.target.key)
}))
const snapshot = computed(() => draft.value ?? installed.value)
const cssIssue = computed(() => themeCssIssue(snapshot.value.css))
const signature = computed(() => JSON.stringify([props.sourceId, props.source]))
const applying = ref(false)
const restoring = ref(false)
const recording = ref(false)
const busy = computed(() => props.pending || applying.value || restoring.value || recording.value)
const error = ref('')
const status = ref('')
const historyOpen = ref(false)
const chosenVersion = ref<number>()
let previewGeneration = 0
let disposed = false
let lastPersisted: { key: string; snapshot: ThemeSnapshot } | undefined

function getContext(): DocumentChatThemeContext | undefined {
  if (!props.documentId || cssIssue.value) return
  const { base, css } = snapshot.value
  return { sourceId: props.sourceId, base, css, baseCss: builtinThemeCss(base) }
}

function localTheme(value: ThemeSnapshot, preview = false): LocalTheme {
  return { version: 1, id: `local:${value.base}:${uuid}`, base: value.base, name: value.name.trim() || t('studio.copy'),
    css: preview ? value.previewCss ?? value.css : value.css, values: {} }
}

function persistDraft(before: ThemeSnapshot, after: ThemeSnapshot, key: string): void {
  const stored = readThemeDraft(key)
  if (stored) {
    if (stored.draft.id.split(':')[2] !== uuid) return
    const current = { name: stored.draft.name, base: stored.draft.base, css: localThemeCss(stored.draft), sample: readDraftSample(key),
      ...(themeCssIssue(stored.draft.css ?? '') ? { previewCss: stored.draft.previewCss ?? '' } : {}) }
    const last = lastPersisted?.key === key ? lastPersisted.snapshot : undefined
    if (!sameThemeSnapshot(current, before) && !(last && sameThemeSnapshot(current, last))) return
  }
  try {
    localStorage.setItem(key, JSON.stringify({ ...localTheme(after), previewCss: after.previewCss }))
    if (after.sample === null) localStorage.removeItem(key + '.sample')
    else localStorage.setItem(key + '.sample', after.sample)
    lastPersisted = { key, snapshot: after }
  } catch { error.value = t('studio.storageError') }
}

function setDraft(value: ThemeSnapshot, documentId?: string): void {
  draft.value = value
  previewDocument.value = documentId
  emit('preview', localTheme(value, true), documentId)
}

function previewHere(): void {
  if (draft.value && props.documentId) setDraft(draft.value, props.documentId)
}

function endPreview(): void {
  clearPreview()
  status.value = t('themeAi.previewEnded')
}

function clearPreview(): void {
  previewGeneration++
  closeHistory()
  status.value = ''
  error.value = ''
  draft.value = undefined
  previewDocument.value = undefined
  emit('preview', null)
}

async function previewProposal(turnId: string, proposal: DocumentChatThemeProposal, profile?: string): Promise<void> {
  if (applying.value || restoring.value || recording.value) return
  const documentId = props.documentId
  if (!documentId || proposal.sourceId !== props.sourceId ||
    proposal.beforeCss !== snapshot.value.css || themeCssIssue(proposal.css)) {
    error.value = t('themeAi.changed')
    return
  }
  error.value = ''
  const before = snapshot.value
  const after = { ...before, css: proposal.css }
  const generation = previewGeneration
  const source = signature.value
  recording.value = true
  try {
    const version = await versions.record('ai', before, after, {
      revision: turnId, model: profile ? { profile, locale: locale.value } : undefined
    })
    if (disposed || generation !== previewGeneration || source !== signature.value || documentId !== props.documentId) return
    if (!version) {
      error.value = t('themeHistory.storageError')
      return
    }
    persistDraft(before, after, props.target.key)
    setDraft(after, documentId)
  } finally {
    recording.value = false
  }
}

async function applyProposal(turnId: string, proposal: DocumentChatThemeProposal, profile?: string): Promise<DocumentChatThemeEffect | null> {
  if (applying.value || restoring.value || recording.value) return null
  const before = snapshot.value
  if (proposal.sourceId !== props.sourceId || proposal.beforeCss !== before.css || themeCssIssue(proposal.css)) return null
  const after = { ...before, css: proposal.css }
  const key = props.target.key
  applying.value = true
  try {
    const effect = await ipc.invoke('mt::document-chat::apply-theme', localTheme(after), props.sourceId,
      props.source ? JSON.parse(JSON.stringify(props.source)) as LocalTheme : null, before.css)
    if (!effect) return null
    await versions.record('ai', before, { ...after, name: effect.after.name }, {
      revision: turnId, model: profile ? { profile, locale: locale.value } : undefined
    }).catch(() => { error.value = t('themeHistory.storageError') })
    persistDraft(before, { ...after, name: effect.after.name }, key)
    clearPreview()
    status.value = t('themeAi.applied')
    return effect
  } finally { applying.value = false }
}

async function review(turnId: string, proposal: DocumentChatThemeProposal, profile?: string): Promise<void> {
  if (busy.value) return
  error.value = ''
  const generation = previewGeneration
  try {
    const history = await readThemeVersions(uuid)
    if (disposed || generation !== previewGeneration) return
    if (!history.some(version => version.revision === turnId)) {
      await previewProposal(turnId, proposal, profile)
      if (disposed || generation !== previewGeneration || error.value) return
    }
    await versions.open(snapshot.value)
    if (disposed || generation !== previewGeneration) return
    chosenVersion.value = entries.value.find(version => version.revision === turnId)?.id
    historyOpen.value = !!chosenVersion.value || versionFailed.value
  } catch {
    error.value = t('themeHistory.storageError')
  }
}

function closeHistory(): void {
  historyOpen.value = false
  versions.close()
}

async function restore(entry: ThemeVersion): Promise<void> {
  if (busy.value || versionFailed.value) return
  restoring.value = true
  const before = snapshot.value
  const generation = previewGeneration
  try {
    const version = await versions.record('restore', before, entry.snapshot, { restoredAt: entry.time })
    if (version && !disposed && generation === previewGeneration) {
      persistDraft(before, entry.snapshot, props.target.key)
      setDraft(entry.snapshot, props.documentId)
    }
  } finally {
    restoring.value = false
  }
}

async function apply(): Promise<void> {
  if (!draft.value || !previewing.value || cssIssue.value || busy.value) return
  const before = draft.value
  const key = props.target.key
  applying.value = true
  error.value = ''
  try {
    const saved = await ipc.invoke('mt::theme::apply-in-editor', localTheme(before), props.sourceId,
      props.source ? JSON.parse(JSON.stringify(props.source)) as LocalTheme : null)
    if (!saved) { error.value = t('studio.storageError'); return }
    const after = { ...before, name: saved.name }
    await versions.record('apply', before, after)
    persistDraft(before, after, key)
    endPreview()
    status.value = t('themeAi.applied')
  } catch (cause) {
    error.value = String(cause).includes('activeThemeChanged') ? t('themeAi.changed') : t('studio.storageError')
  } finally { applying.value = false }
}

watch(signature, () => {
  if (applying.value || !draft.value) return
  clearPreview()
  status.value = t('themeAi.changed')
})

onBeforeUnmount(() => {
  disposed = true
  versions.close()
  emit('preview', null)
})
defineExpose({ getContext, applyProposal, review, clearPreview })
</script>

<style scoped>
.theme-preview > p, .preview-actions {
  margin: 0;
  padding: 6px 8px;
}
.preview-actions {
  display: grid;
  gap: 5px;
  border-top: 1px solid var(--editorColor10);
}
.preview-actions p {
  margin: 0;
}
.preview-actions > div {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.copy-hint {
  color: var(--editorColor70);
  font-size: 12px;
}
[role='alert'] {
  color: var(--deleteColor);
}
</style>
