<template>
  <dialog
    ref="dialog"
    class="theme-history-dialog"
    :aria-labelledby="headingId"
    @close="emit('close')"
    @cancel="cancelConfirmation"
  >
    <header class="history-header">
      <Clock aria-hidden="true" />
      <h2 :id="headingId">
        {{ t('themeHistory.title') }}
      </h2>
      <span>{{ selectedDocument?.target.filename ?? name }}</span>
      <button
        type="button"
        autofocus
        :aria-label="t('editor.mediaViewer.close')"
        @click="dialog?.close()"
      >
        <Close aria-hidden="true" />
      </button>
    </header>
    <p
      v-if="failed || error"
      class="history-message"
      role="alert"
    >
      {{ error || t('themeHistory.storageError') }}
    </p>
    <p
      v-if="documentHistory?.failed"
      class="history-message"
      role="alert"
    >
      {{ t('studio.historyError') }}
    </p>
    <p
      v-if="!selectedEntry && !failed && !error && !documentHistory?.failed"
      class="history-message"
      role="status"
    >
      {{ empty && !documentHistory?.loading ? t(documentHistory ? 'history.empty' : 'themeHistory.empty') : t('themeHistory.loading') }}
    </p>
    <div
      v-if="selectedEntry"
      class="history-layout"
    >
      <nav :aria-label="t('themeHistory.title')">
        <template
          v-for="group in groups"
          :key="group.date"
        >
          <h3>{{ group.date }}</h3>
          <button
            v-for="entry in group.entries"
            :key="entry.key"
            type="button"
            class="history-entry"
            :title="entry.title"
            :aria-pressed="entry.key === selectedEntry.key"
            @click="choose(entry.key)"
          >
            <component
              :is="entry.type === 'document' ? Document : icons[entry.version.kind]"
              aria-hidden="true"
            />
            <span class="entry-content">
              <span class="entry-meta">
                <span
                  v-if="documentHistory"
                  class="entry-category"
                  :class="entry.type"
                >{{ t(`history.${entry.type}`) }}</span>
                <time
                  v-if="entry.time !== undefined"
                  :datetime="new Date(entry.time).toISOString()"
                >{{ time(entry.time) }}</time>
                <strong>{{ entry.type === 'document' ? entry.change.target.filename : kindLabel(entry.version) }}</strong>
                <span
                  v-if="entry.type === 'theme' && entry.version.id === currentId"
                  class="current"
                >{{ currentLabel }}</span>
              </span>
              <span class="entry-summary">{{ entry.title }}</span>
            </span>
          </button>
        </template>
      </nav>
      <document-history-detail
        v-if="selectedDocument"
        :entry="selectedDocument"
        @conversation="emit('conversation', selectedDocument.chatId, selectedDocument.turnId)"
      />
      <section
        v-else-if="selected"
        class="version-detail"
        :aria-label="t('themeHistory.changes')"
      >
        <div class="detail-body">
          <div class="detail-header">
            <span>{{ selected.summary && selected.kind === 'ai' ? t('themeHistory.aiSummary') : kindLabel(selected) }} · {{ date(selected.time) }} {{ time(selected.time) }}</span>
            <div
              v-if="!confirming"
              class="detail-switch"
            >
              <button
                type="button"
                :aria-pressed="!preview"
                @click="preview = false"
              >
                {{ t('themeHistory.changes') }}
              </button>
              <button
                type="button"
                :aria-pressed="preview"
                @click="preview = true"
              >
                {{ t('studio.preview') }}
              </button>
            </div>
          </div>
          <h3 aria-live="polite">
            {{ summary(selected) }}
          </h3>
          <div
            v-if="confirming"
            class="restore-confirmation"
          >
            <strong>{{ t('themeHistory.confirm', { date: date(selected.time), time: time(selected.time) }) }}</strong>
            <p>{{ t(applied ? 'themeHistory.confirmApplyDetail' : 'themeHistory.confirmDetail') }}</p>
          </div>
          <preview-frame
            v-else-if="preview"
            class="version-preview"
            :title="t('studio.preview')"
            :theme="previewTheme"
            :markdown="selected.snapshot.sample ?? themeSample(locale).markdown"
            :sidebar="t('studio.sample')"
            :demo="selected.snapshot.sample === null"
            :source="false"
            filename=""
            @dismiss="dialog?.close()"
          />
          <template v-else-if="changes.length">
            <div class="compare-label">
              {{ t('themeHistory.previous') }}
            </div>
            <div
              v-for="(change, index) in changes"
              :key="index"
              class="change"
            >
              <strong>{{ t('themeHistory.field.' + change.field) }}</strong>
              <code v-if="change.location">{{ change.location }}</code>
              <div class="change-values">
                <code>{{ displayValue(change, change.before) }}</code>
                <span aria-hidden="true">→</span>
                <code>{{ displayValue(change, change.after) }}</code>
              </div>
            </div>
          </template>
          <p v-else>
            {{ t(previous ? 'themeHistory.noChanges' : 'themeHistory.kind.initial') }}
          </p>
        </div>
        <footer class="detail-footer">
          <span>{{ selected.id === currentId ? currentLabel : applied ? '' : t('themeHistory.applyHint') }}</span>
          <template v-if="confirming">
            <button
              type="button"
              @click="cancelRestore"
            >
              {{ t('dialog.cancel') }}
            </button>
            <button
              type="button"
              class="confirm-action"
              :disabled="failed || restoring"
              @click="restore"
            >
              {{ t('themeHistory.confirmRestore') }}
            </button>
          </template>
          <button
            v-else
            ref="restoreButton"
            type="button"
            class="confirm-action"
            :disabled="failed || restoring || selected.id === currentId"
            @click="confirmRestore"
          >
            <RefreshLeft aria-hidden="true" />
            {{ t(applied ? 'themeHistory.restoreAndApply' : 'themeHistory.restore') }}
          </button>
        </footer>
      </section>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Clock, Close, Connection, Document, EditPen, MagicStick, RefreshLeft } from '@element-plus/icons-vue'
import type { DocumentChatHistoryEntry } from '@shared/documentChat'
import { sameThemeSnapshot, themeVersionChanges, type ThemeSnapshot, type ThemeVersionChange } from '@shared/themeVersion'
import type { LocalTheme } from '@shared/localTheme'
import DocumentHistoryDetail from '@/components/history/documentHistoryDetail.vue'
import PreviewFrame from './previewFrame.vue'
import { themeLabel } from './config'
import { themeSample } from './sample'
import type { ThemeVersion } from './themeVersions'

type HistoryVersion = ThemeVersion & { theme?: LocalTheme }
type HistoryEntry =
  | { type: 'theme'; key: string; time: number; title: string; version: HistoryVersion }
  | { type: 'document'; key: string; time?: number; title: string; change: DocumentChatHistoryEntry }

const props = defineProps<{
  name: string
  entries: HistoryVersion[]
  current: ThemeSnapshot
  failed: boolean
  restoring: boolean
  initialVersion?: number
  applied?: boolean
  empty?: boolean
  error?: string
  preferredType?: HistoryEntry['type']
  documentHistory?: { entries: DocumentChatHistoryEntry[]; loading: boolean; failed: boolean }
}>()
const emit = defineEmits<{ close: []; restore: [version: ThemeVersion]; conversation: [chatId: string, turnId: string] }>()
const { t, locale } = useI18n()
const headingId = useId()
const dialog = ref<HTMLDialogElement>()
const restoreButton = ref<HTMLButtonElement>()
const chosen = ref(props.initialVersion === undefined ? undefined : `theme:${props.initialVersion}`)
const preferredType = ref(props.preferredType ?? 'theme')
const preview = ref(false)
const confirming = ref(false)
const icons = { initial: Clock, manual: EditPen, ai: MagicStick, save: Check, apply: Check,
  restore: RefreshLeft, undo: RefreshLeft, collaboration: Connection, recovered: Clock }
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }))
const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
const date = (value: number): string => dateFormat.value.format(value)
const time = (value: number): string => timeFormat.value.format(value)
const timeline = computed(() => {
  const entries = props.entries.map<HistoryEntry>(version => ({
    type: 'theme', key: `theme:${version.id}`, time: version.time, title: summary(version), version
  }))
  if (!props.documentHistory) return entries
  for (const change of props.documentHistory.entries) {
    entries.push({ type: 'document', key: `document:${change.turnId}`, time: change.appliedAt, title: change.prompt, change })
  }
  return entries.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
})
const selectedEntry = computed(() => timeline.value.find(entry => entry.key === chosen.value) ??
  timeline.value.find(entry => entry.type === preferredType.value) ?? timeline.value[0])
const selected = computed(() => selectedEntry.value?.type === 'theme' ? selectedEntry.value.version : undefined)
const selectedDocument = computed(() => selectedEntry.value?.type === 'document' ? selectedEntry.value.change : undefined)
const previous = computed(() => {
  const version = selected.value
  if (!version) return undefined
  const index = props.entries.indexOf(version)
  return version.previous ?? props.entries[index + 1]?.snapshot
})
const currentId = computed(() => props.entries.find(entry => sameThemeSnapshot(entry.snapshot, props.current))?.id)
const currentLabel = computed(() => t(props.applied ? 'themeLibrary.currentlyApplied' : 'themeHistory.current'))
const groups = computed(() => {
  const days = new Map<string, HistoryEntry[]>()
  for (const entry of timeline.value) {
    const key = entry.time === undefined ? t('history.undated') : date(entry.time)
    const group = days.get(key)
    if (group) group.push(entry)
    else days.set(key, [entry])
  }
  return Array.from(days, ([date, entries]) => ({ date, entries }))
})
const changes = computed(() => selected.value && previous.value ? themeVersionChanges(previous.value, selected.value.snapshot) : [])
const previewTheme = computed<LocalTheme | string>(() => {
  const entry = selected.value
  if (!entry) return props.current.base
  if (entry.theme) return entry.theme
  const { name, base, css, previewCss } = entry.snapshot
  return { version: 1, id: `local:${base}:${entry.uuid}`, name: name.trim() || t('studio.copy'), base, css: previewCss ?? css, values: {} }
})

function kindLabel(entry: ThemeVersion): string {
  return t(props.applied && entry.kind === 'recovered' ? 'themeHistory.appliedRecovered' : 'themeHistory.kind.' + entry.kind)
}

function summary(entry: ThemeVersion): string {
  if (entry.summary) return entry.summary
  if (entry.restoredAt !== undefined) return t('themeHistory.restored', { date: date(entry.restoredAt), time: time(entry.restoredAt) })
  if (props.applied && entry.kind === 'ai') return t('themeHistory.appliedAi')
  if (props.applied && entry.kind === 'collaboration') return t('themeHistory.appliedCollaboration')
  if (props.applied && entry.kind === 'recovered') return t('themeHistory.appliedRecovered')
  return t(`themeHistory.description.${entry.kind}`)
}
function displayValue(change: ThemeVersionChange, value: string | null): string {
  if (value === null || value === '') return '—'
  return change.field === 'base' ? themeLabel(value) : value
}
function choose(key: string): void {
  confirming.value = false
  chosen.value = key
}
watch(() => props.preferredType, type => {
  preferredType.value = type ?? 'theme'
  chosen.value = undefined
  confirming.value = false
  preview.value = false
})
function confirmRestore(): void {
  confirming.value = true
  void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>('.confirm-action')?.focus())
}
function cancelRestore(): void {
  confirming.value = false
  void nextTick(() => restoreButton.value?.focus())
}
function cancelConfirmation(event: Event): void {
  if (!confirming.value) return
  event.preventDefault()
  cancelRestore()
}
function restore(): void {
  const entry = selected.value
  if (!entry || entry.id === currentId.value) return
  emit('restore', entry)
  confirming.value = false
  preferredType.value = 'theme'
  chosen.value = undefined
  preview.value = false
}

onMounted(() => dialog.value?.showModal())
</script>

<style scoped>
.theme-history-dialog {
  --studio-divider: var(--editorColor10);
  --studio-outline: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 18%);
  --studio-muted: var(--editorColor60);
  --studio-toolbar: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 2%);
  --studio-hover: var(--editorColor04);
  --studio-tint: var(--themeColor10);
  box-sizing: border-box;
  inset: 0;
  width: min(840px, calc(100vw - 28px));
  max-height: calc(100dvh - 28px);
  padding: 0;
  margin: auto;
  border: 1px solid var(--studio-outline);
  border-radius: 10px;
  color: var(--editorColor);
  background: var(--editorBgColor);
  box-shadow: 0 12px 40px rgb(0 0 0 / 20%);
  font: 13px/1.55 system-ui, sans-serif;
}
.theme-history-dialog button { padding: 5px 8px; border: 1px solid var(--studio-outline); border-radius: 6px; background: var(--editorBgColor); color: var(--editorColor); font: inherit; cursor: pointer; }
.theme-history-dialog button:disabled { opacity: .5; cursor: default; }
.theme-history-dialog button:focus-visible { outline: 2px solid var(--themeColor); outline-offset: 1px; }
.theme-history-dialog[open] { display: flex; flex-direction: column; }
.theme-history-dialog::backdrop { background: rgb(0 0 0 / 32%); }
.theme-history-dialog svg { width: 16px; height: 16px; flex: none; }
.history-header { display: flex; align-items: center; gap: 8px; padding: 11px 15px; border-bottom: 1px solid var(--studio-divider); }
.history-header h2 { margin: 0; font-size: 17px; white-space: nowrap; }
.history-header span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-header button { margin-inline-start: auto; }
.history-header button, .detail-switch button { display: inline-flex; align-items: center; }
.history-message { margin: 0; padding: 12px 15px; }
.history-layout { display: grid; grid-template-columns: minmax(220px, 34%) minmax(0, 1fr); min-height: 0; height: min(445px, calc(100dvh - 82px)); }
.history-layout nav { min-height: 0; overflow-y: auto; padding: 8px; border-inline-end: 1px solid var(--studio-divider); background: var(--studio-toolbar); }
.history-layout nav h3 { margin: 9px 8px 4px; font-size: 12px; font-weight: 600; color: var(--studio-muted); }
.history-layout .history-entry { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 7px 8px; text-align: start; border-color: transparent; background: transparent; }
.history-layout .history-entry svg { margin-top: 2px; color: var(--themeColor); }
.history-layout .history-entry:hover { background: var(--studio-hover); }
.history-layout .history-entry[aria-pressed=true] { border-color: var(--themeColor30, var(--studio-divider)); background: var(--studio-tint); }
.entry-content { min-width: 0; }
.entry-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px; font-size: 12px; }
.entry-meta time { color: var(--studio-muted); font-variant-numeric: tabular-nums; }
.entry-meta strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-category {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--studio-divider);
  color: var(--editorColor);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.entry-category.theme { background: var(--studio-tint); color: var(--themeColor); }
.entry-summary { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-summary, .detail-header, .compare-label, .detail-footer > span, .history-header span { color: var(--studio-muted); font-size: 12px; }
.current { padding-inline: 4px; border-radius: 4px; color: var(--themeColor); background: var(--studio-tint); white-space: nowrap; }
.version-detail { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.detail-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; }
.detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; flex-wrap: wrap; }
.detail-body h3 { margin: 8px 0 12px; font-size: 16px; overflow-wrap: anywhere; }
.detail-switch { display: flex; gap: 3px; align-items: center; }
.detail-switch button[aria-pressed=true] { background: var(--studio-tint); }
.compare-label { text-align: end; margin-bottom: 3px; }
.change { display: grid; gap: 3px; padding: 7px 0; border-top: 1px solid var(--studio-divider); }
.change > code { color: var(--studio-muted); overflow-wrap: anywhere; }
.change-values { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: start; gap: 8px; }
.change-values code { white-space: pre-wrap; overflow-wrap: anywhere; padding: 2px 5px; border-radius: 4px; background: var(--studio-toolbar); }
.confirm-action { display: inline-flex; align-items: center; gap: 5px; }
.theme-history-dialog .confirm-action { border-color: transparent; background: var(--buttonPrimaryBgColor); color: var(--buttonPrimaryFontColor); }
.theme-history-dialog .confirm-action:enabled:hover { background: var(--buttonPrimaryBgColorHover); }
.detail-footer { display: flex; align-items: center; justify-content: end; flex-wrap: wrap; gap: 7px; padding: 9px 12px; border-top: 1px solid var(--studio-divider); }
.detail-footer > span { margin-inline-end: auto; }
.restore-confirmation { padding: 10px; border: 1px solid var(--studio-divider); border-radius: 6px; }
.restore-confirmation p { margin: 4px 0 0; }
.theme-history-dialog .version-preview { height: clamp(140px, 35dvh, 320px); border: 1px solid var(--studio-divider); border-radius: 6px; }
@media (max-width: 580px) {
  .history-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 2fr) minmax(0, 3fr); }
  .history-layout nav { border-inline-end: 0; border-bottom: 1px solid var(--studio-divider); }
}
</style>
