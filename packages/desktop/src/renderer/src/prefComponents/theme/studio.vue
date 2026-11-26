<template>
  <div class="theme-studio">
    <header class="studio-toolbar">
      <div class="draft-controls">
        <slot
          name="library"
          :theme="draft"
          :disabled="saving || collaborationOpening || collaborationStopping || switching"
        />
        <input
          v-model="draft.name"
          class="theme-name"
          :aria-label="t('studio.name')"
          :title="t('studio.name')"
          :maxlength="maxThemeNameLength"
          :disabled="switching"
          spellcheck="false"
        >
        <div class="base-control select-control">
          <Moon
            v-if="isDarkThemeId(draft.base)"
            aria-hidden="true"
          />
          <Sunny
            v-else
            aria-hidden="true"
          />
          <select
            :aria-label="t('studio.base')"
            :title="t('studio.base')"
            :value="draft.base"
            :disabled="editing || externalCapturing || collaborationOpening || switching"
            @change="changeBase"
          >
            <option
              v-for="base in themeBases"
              :key="base"
              :value="base"
            >
              {{ themeLabel(base) }}
            </option>
          </select>
        </div>
      </div>
      <div
        class="preview-switch"
        role="group"
        :aria-label="t('studio.preview')"
      >
        <button
          :aria-pressed="!source"
          @click="source = false"
        >
          <Document aria-hidden="true" />
          {{ t('studio.document') }}
        </button>
        <button
          :aria-pressed="source"
          @click="source = true"
        >
          <Tickets aria-hidden="true" />
          {{ t('studio.source') }}
        </button>
      </div>
      <div class="theme-save">
        <button
          type="button"
          class="primary save-theme"
          :disabled="saveDisabled || alreadySaved"
          @click="saveTheme(false)"
        >
          <Check aria-hidden="true" />
          {{ t('studio.saveOnly') }}
        </button>
        <button
          type="button"
          class="primary save-options-trigger"
          :disabled="saveDisabled || alreadyApplied"
          :aria-label="t('studio.saveOptions')"
          :title="t('studio.saveOptions')"
          aria-haspopup="dialog"
          popovertarget="theme-save-options"
        >
          <ArrowDown aria-hidden="true" />
        </button>
        <div
          id="theme-save-options"
          ref="saveOptions"
          class="save-options"
          popover="auto"
          role="dialog"
          :aria-label="t('studio.saveOptions')"
        >
          <button
            type="button"
            class="toolbar-action"
            :disabled="saveDisabled || alreadyApplied"
            autofocus
            @click="saveTheme(true)"
          >
            {{ t('studio.saveAndApply') }}
          </button>
        </div>
      </div>
    </header>

    <main :class="{ inspecting: inspectorOpen }">
      <section class="preview panel">
        <div
          class="preview-frame"
          :style="{ backgroundColor: getThemeBackgroundColor(draft.base) }"
        >
          <iframe
            ref="frame"
            src="./theme-preview.html"
            :title="t('studio.preview')"
            @load="previewReady"
          />
        </div>
        <p
          v-if="inspectorOpen"
          class="inspect-hint muted"
        >
          {{ t('studio.inspectHint') }}
        </p>
      </section>

      <section class="tools panel">
        <div class="bar tools-bar">
          <button
            class="toolbar-action tool-icon"
            :aria-pressed="inspectorOpen"
            :aria-label="t('studio.inspect')"
            :title="t('studio.inspect')"
            @click="setInspector(!inspectorOpen)"
          >
            <Aim aria-hidden="true" />
          </button>
        </div>
        <div class="source-options">
          <label><input
            v-model="showBase"
            type="checkbox"
            @change="finishTyping"
          > {{ t('studio.baseSource') }}</label>
          <div
            v-if="inspectorOpen"
            class="selector-action"
          >
            <select
              v-if="selectorChoices.length"
              v-model="chosenSelector"
              :aria-label="t('studio.selector')"
            >
              <option
                v-for="item in selectorChoices"
                :key="item.selector"
                :value="item.selector"
              >
                {{ item.selector }}
              </option>
            </select>
            <button
              :disabled="!choice || externalCapturing || !!issue || choicesCss !== css"
              @click="useSelectedRule"
            >
              {{ t(choice && choice.offset !== null ? 'studio.locateSelector' : 'studio.addSelector') }}
            </button>
          </div>
        </div>
        <css-source
          ref="sourceEditor"
          :key="String(showBase)"
          :model-value="showBase ? formattedBase : css"
          :readonly="showBase"
          :dark="isDarkThemeId(draft.base)"
          :label="showBase ? t('studio.baseSource') : t('studio.css')"
          @update:model-value="typeCss"
        />
      </section>
    </main>
    <footer>
      <button
        class="toolbar-action"
        :aria-label="t('studio.undo')"
        :title="t('studio.undo')"
        :disabled="switching || externalCapturing || (!undoStack.length && typingStart === undefined)"
        @click="undo"
      >
        <RefreshLeft aria-hidden="true" />
        {{ t('menu.edit.undo') }}
      </button>
      <button
        class="toolbar-action file-menu-trigger"
        popovertarget="theme-files"
        aria-haspopup="dialog"
      >
        <Files aria-hidden="true" />
        {{ t('studio.themeFiles') }}
        <ArrowDown
          class="menu-chevron"
          aria-hidden="true"
        />
      </button>
      <div
        id="theme-files"
        ref="themeFilesMenu"
        class="footer-popover theme-files-menu"
        popover="auto"
        role="dialog"
        :aria-label="t('studio.themeFiles')"
      >
        <button
          class="toolbar-action"
          :disabled="externalCapturing || collaborationOpening"
          @click="chooseThemeImport"
        >
          <Upload aria-hidden="true" />
          {{ t('studio.import') }}
        </button>
        <button
          class="toolbar-action"
          :disabled="externalCapturing || !!issue"
          @click="exportTheme"
        >
          <Download aria-hidden="true" />
          {{ t('studio.export') }}
        </button>
      </div>
      <input
        ref="themePicker"
        type="file"
        accept=".json"
        hidden
        @change="importTheme"
      >
      <button
        class="toolbar-action collaboration-trigger"
        popovertarget="theme-collaboration"
        aria-haspopup="dialog"
      >
        <Connection aria-hidden="true" />
        {{ t('themeCollaboration.title') }}
        <ArrowDown
          class="menu-chevron"
          aria-hidden="true"
        />
      </button>
      <div
        id="theme-collaboration"
        ref="collaborationMenu"
        class="footer-popover collaboration-menu"
        popover="auto"
        role="dialog"
        :aria-label="t('themeCollaboration.title')"
      >
        <code v-if="collaborationDirectory">{{ collaborationDirectory }}</code>
        <div class="collaboration-actions">
          <button
            :disabled="collaborationInstalling"
            @click="collaboration.install"
          >
            {{ t('themeCollaboration.install') }}
          </button>
          <button
            v-if="!collaborationDirectory"
            :disabled="collaborationOpening || !!issue"
            @click="startCollaboration"
          >
            {{ t('themeCollaboration.start') }}
          </button>
          <template v-else>
            <button @click="openCollaborationDirectory">
              {{ t('themeCollaboration.open') }}
            </button>
            <button @click="collaboration.copyDirectory">
              {{ t('themeCollaboration.copy') }}
            </button>
            <button
              :disabled="collaborationStopping"
              @click="stopCollaboration"
            >
              {{ t('themeCollaboration.stop') }}
            </button>
          </template>
        </div>
        <p
          v-if="collaborationNotice"
          role="status"
        >
          {{ t('themeCollaboration.' + collaborationNotice) }}
        </p>
      </div>
      <div class="footer-status">
        <span
          v-if="issue || error || collaborationError || workspaceError"
          role="alert"
        >{{ issue ? t('studio.cssIssue') + ' · ' + issue : error || collaborationError || workspaceError }}</span>
        <span
          v-else-if="!collaborationDirectory"
          class="muted"
          role="status"
        >{{ t('studio.draft') }}</span>
        <span
          v-if="collaborationDirectory"
          class="collaboration-status muted"
          role="status"
        >{{ t('themeCollaboration.active') }}</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Aim, ArrowDown, Check, Document, Download, Files,
  Moon, RefreshLeft, Sunny, Tickets, Upload } from '@element-plus/icons-vue'
import { getThemeBackgroundColor, isDarkThemeId } from 'common/theme'
import { themeCssIssue } from '@shared/themeCss'
import { parse } from 'postcss'
import { builtinThemeCss } from '@/util/builtinTheme'
import { localThemeCss } from '@/util/themeOverrides'
import CssSource from './cssSource.vue'
import type { SelectorChoice } from './selectorRules'
import { isLocalTheme, maxThemeNameLength, themeBases, type LocalTheme, type PreparedPreview, type PreviewTarget } from '@shared/localTheme'
import { themeLabel } from './config'
import { themeSample } from './sample'
import { editableTheme, readDraftSample, type ThemeDraftEntry } from './themeDrafts'
import type { ThemeCollaborationCapture, ThemeCollaborationFiles } from '@shared/themeCollaboration'
import { useThemeCollaboration } from './useThemeCollaboration'

const props = defineProps<{
  entry: ThemeDraftEntry
  savedTheme?: LocalTheme
  appliedId: string
  switching: boolean
  workspaceError: string
}>()
const emit = defineEmits<{ saved: [theme: LocalTheme, apply: boolean]; imported: [theme: LocalTheme] }>()
const { t, locale } = useI18n()
const ipc = window.electron.ipcRenderer
const storageKey = props.entry.key
let temporaryDraft = sessionStorage.getItem(storageKey) !== null && localStorage.getItem(storageKey) === null
const sampleKey = storageKey + '.sample'
const collaborationKey = storageKey + '.collaboration'
const restoredPreview = props.entry.draft.previewCss
const draft = ref(editableTheme(props.entry.draft))
const editing = computed(() => props.savedTheme?.id === draft.value.id)
const source = ref(false)
const showBase = ref(false)
const inspectorOpen = ref(false)
const sourceEditor = ref<InstanceType<typeof CssSource>>()
const selectorChoices = ref<SelectorChoice[]>([])
const choicesCss = ref('')
const chosenSelector = ref('')
const choice = computed(() => selectorChoices.value.find(item => item.selector === chosenSelector.value))
const css = computed(() => draft.value.css ?? '')
const issue = computed(() => themeCssIssue(css.value))
const previewCss = ref(issue.value ? (typeof restoredPreview === 'string' && !themeCssIssue(restoredPreview) ? restoredPreview : '') : css.value)
const alreadySaved = computed(() => editing.value && props.savedTheme?.name === draft.value.name.trim() &&
  !Object.keys(props.savedTheme.values).length && localThemeCss(props.savedTheme) === css.value)
const alreadyApplied = computed(() => alreadySaved.value && props.appliedId === draft.value.id)
const baseCss = computed(() => builtinThemeCss(draft.value.base))
const formattedBase = computed(() => {
  const root = parse(baseCss.value)
  const childIndent = new WeakMap<object, string>()
  root.walk(node => {
    const indent = node.parent ? childIndent.get(node.parent) ?? '' : ''
    childIndent.set(node, indent + '  ')
    node.raws.before = node === root.first ? '' : '\n' + indent
    if (node.type === 'decl') node.raws.between = ': '
    if (node.type === 'rule' || (node.type === 'atrule' && node.nodes)) {
      node.raws.between = ' '
      node.raws.after = '\n' + indent
      node.raws.semicolon = true
    }
  })
  return root.toString()
})
interface DraftEdits { css: string; sample: string | null }
const undoStack = ref<DraftEdits[]>([])
const typingStart = ref<DraftEdits>()
const frame = ref<HTMLIFrameElement>()
const themePicker = ref<HTMLInputElement>()
const collaborationMenu = ref<HTMLElement>()
const sampleOverride = ref(readDraftSample(storageKey))
const sampleMarkdown = computed(() => sampleOverride.value ?? themeSample(locale.value).markdown)
let captureRequest: { token: string; controller: AbortController; port?: MessagePort; snapshot?: ThemeCollaborationFiles } | undefined
const externalCapturing = ref(false)
const saving = ref(false)
const saveOptions = ref<HTMLElement>()
let leaving = false
const error = ref('')
const collaboration = useThemeCollaboration({
  files: () => ({ css: css.value, sampleMarkdown: sampleMarkdown.value }),
  baseCss: () => baseCss.value,
  valid: () => !issue.value,
  update: applyCollaborationFiles,
  capture: captureCollaborationPreview
})
const { directory: collaborationDirectory, issue: collaborationIssue, opening: collaborationOpening,
  stopping: collaborationStopping, installing: collaborationInstalling, notice: collaborationNotice } = collaboration
const saveDisabled = computed(() => props.switching || saving.value ||
  collaborationOpening.value || collaborationStopping.value || !!collaborationIssue.value || !!issue.value || !draft.value.name.trim())
const collaborationError = computed(() => {
  const problem = collaborationIssue.value
  if (problem?.kind === 'css') return t('themeCollaboration.cssError', { detail: problem.detail })
  if (problem?.kind === 'sample') return t('themeCollaboration.sampleError')
  return problem || collaboration.failure.value ? t('themeCollaboration.filesError') : ''
})
let unsubscribeInspector: (() => void) | undefined

function updatePreview(paintPort?: MessagePort, captureTarget?: PreviewTarget): void {
  const snapshot = captureRequest?.snapshot
  if (snapshot && !paintPort) return
  const theme = { ...draft.value, name: draft.value.name.trim() || t('studio.copy'), values: {}, css: snapshot?.css ?? previewCss.value }
  const markdown = snapshot?.sampleMarkdown ?? sampleMarkdown.value
  frame.value?.contentWindow?.postMessage({ type: 'theme-preview', theme, source: snapshot ? false : source.value,
    sidebar: t('studio.sample'), markdown, demo: markdown === themeSample(locale.value).markdown, captureTarget }, '*', paintPort ? [paintPort] : [])
}
watch(css, value => {
  if (!issue.value) previewCss.value = value
}, { flush: 'sync' })
watch([() => draft.value.base, previewCss, source, sampleMarkdown], () => updatePreview())
function persistDraft(): void {
  localStorage.setItem(storageKey, JSON.stringify({ ...draft.value, previewCss: previewCss.value }))
}
function saveDraft(): void {
  temporaryDraft = false
  try { persistDraft() }
  catch { error.value = t('studio.storageError') }
}
function persistSample(value: string | null): void {
  if (value === null) localStorage.removeItem(sampleKey)
  else localStorage.setItem(sampleKey, value)
}
watch([draft, sampleOverride], saveDraft, { deep: true, flush: 'sync' })
watch(sampleOverride, value => {
  try { persistSample(value) }
  catch { error.value = t('studio.storageError') }
}, { flush: 'sync' })

function sendInspectorMode(): void {
  frame.value?.contentWindow?.postMessage({ type: 'theme-preview-inspector', open: inspectorOpen.value }, '*')
}
function previewReady(): void {
  updatePreview()
  sendInspectorMode()
}
function inspectorChanged(open: boolean): void {
  inspectorOpen.value = open
  if (!open) selectorChoices.value = []
  sendInspectorMode()
}
async function setInspector(open: boolean): Promise<void> {
  try {
    await ipc.invoke('mt::theme::set-inspector', open)
  } catch {
    error.value = t('studio.inspectorFailed')
  }
}
async function useSelectedRule(): Promise<void> {
  const selected = choice.value
  if (!selected || !inspectorOpen.value || externalCapturing.value || issue.value || choicesCss.value !== css.value) return
  finishTyping()
  showBase.value = false
  await nextTick()
  sourceEditor.value?.useSelector(selected)
  finishTyping()
}
async function previewEvent(event: MessageEvent): Promise<void> {
  const preview = frame.value
  if (!preview || event.source !== preview.contentWindow) return
  const data = event.data
  if (data?.type === 'theme-preview-ready') {
    previewReady()
  } else if (data?.type === 'theme-preview-selectors' && inspectorOpen.value) {
    const choices: SelectorChoice[] = data.choices
    selectorChoices.value = choices
    choicesCss.value = data.css
    if (!choices.some(item => item.selector === chosenSelector.value)) {
      chosenSelector.value = (choices.find(item => item.offset !== null) ?? choices[0])?.selector ?? ''
    }
  } else if (data?.type === 'theme-preview-point' && inspectorOpen.value) {
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y) ||
      data.x < 0 || data.y < 0 || data.x >= preview.clientWidth || data.y >= preview.clientHeight) return
    const bounds = preview.getBoundingClientRect()
    try {
      await ipc.invoke('mt::theme::inspect-element', bounds.left + preview.clientLeft + data.x,
        bounds.top + preview.clientTop + data.y)
    } catch {
      error.value = t('studio.inspectorFailed')
    }
  }
}
function changeBase(event: Event): void {
  const base = (event.target as HTMLSelectElement).value
  draft.value = { ...draft.value, base, id: 'local:' + base + ':' + draft.value.id.split(':')[2] }
}
function currentEdits(): DraftEdits {
  return { css: css.value, sample: sampleOverride.value }
}
function matchesCurrentEdits(edits: DraftEdits): boolean {
  return edits.css === css.value && edits.sample === sampleOverride.value
}
function restoreEdits(edits: DraftEdits): void {
  draft.value.css = edits.css
  sampleOverride.value = edits.sample
}
function remember(before: DraftEdits | undefined): void {
  if (before && !matchesCurrentEdits(before)) undoStack.value = [...undoStack.value.slice(-29), before]
}
function finishTyping(): void {
  remember(typingStart.value)
  typingStart.value = undefined
}
function typeCss(value: string): void {
  if (leaving || props.switching) return
  typingStart.value ??= currentEdits()
  draft.value.css = value
}
function undo(): void {
  if (leaving || props.switching) return
  finishTyping()
  const previous = undoStack.value.pop()
  if (previous) restoreEdits(previous)
}
async function prepareToLeave(): Promise<void> {
  if (saving.value || collaborationOpening.value || collaborationStopping.value) throw new Error('studioBusy')
  leaving = true
  finishTyping()
  if (collaborationDirectory.value) {
    await collaboration.stop()
    if (collaborationDirectory.value) throw new Error('collaborationStopFailed')
  }
  if (!temporaryDraft) {
    persistDraft()
    persistSample(sampleOverride.value)
  }
}
function resumeDraft(): void {
  if (!leaving) return
  leaving = false
  if (!collaborationDirectory.value && localStorage.getItem(collaborationKey) === draft.value.id.split(':')[2]) void startCollaboration()
}
function copyDraft(): { theme: LocalTheme; sample: string | null } {
  return { theme: editableTheme(draft.value), sample: sampleOverride.value }
}
defineExpose({ prepareToLeave, resumeDraft, copyDraft })

async function startCollaboration(): Promise<void> {
  if (leaving) return
  finishTyping()
  saveDraft()
  const id = draft.value.id.split(':')[2]
  await collaboration.start(id)
  if (collaborationDirectory.value) localStorage.setItem(collaborationKey, id)
}
async function stopCollaboration(): Promise<void> {
  await collaboration.stop()
  if (!collaborationDirectory.value) localStorage.removeItem(collaborationKey)
}
async function openCollaborationDirectory(): Promise<void> {
  await collaboration.openDirectory()
  if (!collaborationNotice.value) collaborationMenu.value?.hidePopover()
}
function applyCollaborationFiles(files: Partial<ThemeCollaborationFiles>): void {
  const cssChanged = files.css !== undefined && files.css !== css.value
  const sampleChanged = files.sampleMarkdown !== undefined && files.sampleMarkdown !== sampleMarkdown.value
  if (!cssChanged && !sampleChanged) return
  finishTyping()
  const before = currentEdits()
  if (cssChanged) draft.value.css = files.css
  if (sampleChanged) sampleOverride.value = files.sampleMarkdown ?? null
  remember(before)
}
async function prepareCapture(token: string, target: PreviewTarget, snapshot: ThemeCollaborationFiles): Promise<void> {
  captureFinished()
  const controller = new AbortController()
  const pending: NonNullable<typeof captureRequest> = { token, controller, snapshot }
  captureRequest = pending
  externalCapturing.value = true
  try {
    controller.signal.throwIfAborted()
    const { port1, port2 } = new MessageChannel()
    pending.port = port1
    port1.onmessage = (event: MessageEvent<PreparedPreview>) => {
      if (!controller.signal.aborted) ipc.send('mt::theme::preview-painted', token, event.data)
    }
    updatePreview(port2, target)
  } catch {
    if (!controller.signal.aborted) ipc.send('mt::theme::preview-painted', token, { error: 'Preview unavailable.' })
  }
}
function captureFinished(): void {
  const restorePreview = !!captureRequest?.snapshot
  captureRequest?.controller.abort()
  captureRequest?.port?.postMessage('release')
  captureRequest?.port?.close()
  captureRequest = undefined
  externalCapturing.value = false
  if (restorePreview) updatePreview()
}
function captureCollaborationPreview(event: ThemeCollaborationCapture): void {
  if ('releaseCapture' in event) {
    if (captureRequest?.token === event.releaseCapture) captureFinished()
    return
  }
  if (captureRequest) {
    ipc.send('mt::theme::preview-painted', event.prepareCapture, { error: 'The theme preview is busy. Retry after the current operation.' })
    return
  }
  collaborationMenu.value?.hidePopover()
  void prepareCapture(event.prepareCapture, event.target, { css: event.css, sampleMarkdown: event.sampleMarkdown })
}
async function saveTheme(apply: boolean): Promise<void> {
  if (leaving || saveDisabled.value || (apply ? alreadyApplied.value : alreadySaved.value)) return
  saveOptions.value?.hidePopover()
  saving.value = true
  error.value = ''
  try {
    const synced = await collaboration.flush()
    if (!synced) { error.value = t('themeCollaboration.applyError'); return }
    const theme = JSON.parse(JSON.stringify(draft.value)) as LocalTheme
    const saved = await ipc.invoke('mt::theme::save', theme, apply)
    if (!saved) { error.value = t('studio.storageError'); return }
    if (saved.id === draft.value.id) {
      draft.value.name = saved.name
      saveDraft()
    }
    emit('saved', saved, apply)
  } catch { error.value = t('studio.storageError') }
  finally { saving.value = false }
}
async function exportTheme(): Promise<void> {
  if (!isLocalTheme(draft.value)) { error.value = t('studio.nameRequired'); return }
  const filename = draft.value.name.replace(/[^\p{L}\p{N} _-]/gu, '-')
  const json = JSON.stringify(draft.value, null, 2)
  try {
    const path = await window.electron.dialog.showSave({
      title: t('studio.export'), defaultPath: filename + '.theme.json', filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (path) await window.fileUtils.writeFile(path, json)
  } catch { error.value = t('studio.storageError') }
}
function chooseThemeImport(): void {
  themePicker.value?.click()
}
async function importTheme(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('size')
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    if (!isLocalTheme(parsed)) throw new Error('invalid')
    emit('imported', parsed)
  } catch { error.value = t('studio.invalidFile') }
}
onMounted(async() => {
  if (localStorage.getItem(collaborationKey) === draft.value.id.split(':')[2]) void startCollaboration()
  window.addEventListener('message', previewEvent)
  unsubscribeInspector = ipc.on('mt::theme::inspector-changed', (_event, open) => inspectorChanged(open))
  void ipc.invoke('mt::theme::inspector-state').then(inspectorChanged).catch(() => { error.value = t('studio.inspectorFailed') })
})
onBeforeUnmount(() => {
  captureFinished()
  unsubscribeInspector?.()
  window.removeEventListener('message', previewEvent)
})
</script>

<style scoped>
.theme-studio {
  --studio-divider: var(--editorColor10);
  --studio-outline: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 18%);
  --studio-muted: var(--editorColor60);
  --studio-toolbar: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 2%);
  --studio-canvas: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 5%);
  --studio-hover: var(--editorColor04);
  box-sizing: border-box;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: var(--editorColor);
  background: var(--editorBgColor);
  font: 13px/1.55 system-ui, sans-serif;
}

.theme-studio :deep(button), .theme-name, select, textarea {
  box-sizing: border-box;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--studio-outline);
  border-radius: 6px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  font: inherit;
}
.theme-studio :deep(button) { cursor: pointer; }
button:disabled, select:disabled { opacity: .5; cursor: default; }
.theme-studio :deep(:focus-visible) { outline: 2px solid var(--themeColor); outline-offset: 1px; }

.studio-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  min-height: 56px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--studio-divider);
  background: var(--studio-toolbar);
}
.draft-controls { display: flex; align-items: center; gap: 10px; min-width: 0; }
.theme-studio .theme-name {
  width: min(100%, 26ch);
  min-height: 34px;
  flex: 0 1 26ch;
  border-color: transparent;
  font-weight: 600;
  background: transparent;
  text-overflow: ellipsis;
}
.theme-studio .theme-name:hover { border-color: var(--studio-divider); }
.select-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
  border-radius: 6px;
  color: var(--studio-muted);
}
.select-control:hover { background: var(--studio-hover); }
.select-control select {
  display: block;
  width: 100%;
  min-height: 30px;
  appearance: none;
  border: 0;
  padding: 4px 22px 4px 8px;
  color: inherit;
  background: transparent;
  text-overflow: ellipsis;
}
.select-control::after {
  content: '';
  position: absolute;
  inset-inline-end: 8px;
  inset-block-start: calc(50% - 4px);
  width: 5px;
  height: 5px;
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  transform: rotate(45deg);
  pointer-events: none;
}
.base-control { flex: 0 1 auto; max-width: 48%; }
.base-control::before {
  content: '';
  position: absolute;
  inset-inline-start: -6px;
  height: 18px;
  border-inline-start: 1px solid var(--studio-divider);
}
.base-control select { padding-inline-start: 24px; }
.base-control > svg { position: absolute; inset-inline-start: 6px; pointer-events: none; }
.preview-switch {
  display: inline-flex;
  justify-self: center;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--studio-canvas);
}
.preview-switch button, .tools-bar button, .theme-studio .toolbar-action, .primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  white-space: nowrap;
}
.preview-switch button {
  min-height: 28px;
  padding: 3px 8px;
  border-radius: 5px;
  background: transparent;
  color: var(--studio-muted);
}
.preview-switch button[aria-pressed=true] {
  background: var(--editorBgColor);
  color: var(--editorColor);
  font-weight: 600;
  box-shadow: 0 1px 4px var(--editorColor10);
}
.theme-studio .toolbar-action {
  min-height: 32px;
  padding: 4px 8px;
  background: transparent;
  color: var(--studio-muted);
}
.theme-studio .toolbar-action:enabled:hover, .theme-studio .toolbar-action[aria-pressed=true] {
  background: var(--studio-hover);
  color: var(--editorColor);
}
.theme-studio .primary {
  min-height: 33px;
  padding: 5px 12px;
  border-radius: 7px;
  background: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
  font-weight: 600;
}
.theme-studio .primary:enabled:hover { background: var(--buttonPrimaryBgColorHover); }
.theme-save { display: flex; justify-self: end; }
.theme-save .save-theme { border-start-end-radius: 0; border-end-end-radius: 0; }
.theme-save .save-options-trigger {
  anchor-name: --theme-save-options;
  padding-inline: 7px;
  border-inline-start: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}
.theme-save .primary:focus-visible { z-index: 1; }
.save-options {
  position: fixed;
  position-anchor: --theme-save-options;
  inset: auto;
  inset-block-start: anchor(end);
  inset-inline-end: anchor(end);
  margin: 4px 0 0;
  padding: 4px;
  border: 1px solid var(--studio-outline);
  border-radius: 7px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  box-shadow: 0 4px 14px var(--editorColor10);
}
.studio-toolbar svg, .tools-bar svg, footer svg {
  width: 15px;
  height: 15px;
  flex: none;
}

main { min-height: 0; display: grid; grid-template-columns: minmax(0, 3fr) minmax(265px, 2fr); }
.panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
main.inspecting { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1.25fr) minmax(0, 1fr); }
main.inspecting .tools { border-inline-start: 0; border-top: 1px solid var(--studio-divider); }
.preview { background: var(--studio-canvas); }
.preview-frame {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin: clamp(12px, 2.3vw, 26px);
  /* Capture hit-tests the iframe corners, so the rounding stays on the frame around it. */
  padding: 4px;
  border: 1px solid var(--studio-divider);
  border-radius: 10px;
  box-shadow: 0 2px 8px var(--editorColor10);
}
.preview-frame iframe { width: 100%; flex: 1; min-height: 0; border: 0; }
.inspect-hint { margin: 0; padding: 0 14px 8px; }
.tools { border-inline-start: 1px solid var(--studio-divider); }
.tools-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 45px;
  padding-inline: 15px 10px;
  border-bottom: 1px solid var(--studio-divider);
}
.tool-icon { flex: none; width: 33px; }
.source-options { padding: 8px 14px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.selector-action { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.selector-action select { max-width: min(28ch, 100%); font-family: monospace; }
.source-options label { display: flex; align-items: center; }
.tools .css-source { margin: 0 12px 12px; border: 1px solid var(--studio-divider); border-radius: 8px; }

.muted { color: var(--studio-muted); font-size: 12px; }

footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--studio-divider);
  background: var(--studio-toolbar);
}
.footer-status { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 4px 9px; min-width: 0; }
.collaboration-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.collaboration-status::before { content: ''; width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--themeColor); }
.file-menu-trigger { anchor-name: --theme-files; }
.collaboration-trigger { anchor-name: --theme-collaboration; margin-inline-start: auto; }
footer .menu-chevron { width: 11px; height: 11px; }
.footer-popover {
  position: fixed;
  inset: auto;
  bottom: anchor(top);
  position-try-fallbacks: flip-inline, flip-block, flip-inline flip-block;
  max-width: min(360px, calc(100vw - 24px));
  margin: 0 0 6px;
  border: 1px solid var(--studio-outline);
  border-radius: 8px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  box-shadow: 0 4px 14px var(--editorColor10);
}
.theme-files-menu { position-anchor: --theme-files; left: anchor(left); padding: 4px; }
.theme-files-menu .toolbar-action { display: flex; justify-content: flex-start; width: 100%; }
.collaboration-menu { position-anchor: --theme-collaboration; right: anchor(right); padding: 12px; }
.collaboration-menu p { margin: 0; }
.collaboration-menu code { display: block; padding-block: 4px 8px; overflow-wrap: anywhere; user-select: text; }
.collaboration-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.collaboration-actions + p { margin-top: 8px; }
[role=alert] { color: var(--deleteColor); }

@media (max-width: 780px) {
  .studio-toolbar { gap: 8px; }
}
@media (max-width: 580px) {
  .studio-toolbar { grid-template-columns: minmax(0, 1fr) auto; }
  .preview-switch { grid-row: 2; grid-column: 1 / -1; }
  .theme-save { grid-row: 1; grid-column: 2; }
}
</style>
