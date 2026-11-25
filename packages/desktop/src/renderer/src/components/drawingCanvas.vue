<template>
  <div
    class="drawing-workspace"
    @keydown.capture="handleShortcut"
  >
    <div
      class="drawing-toolbar"
      :class="{ 'drawing-toolbar-with-tabs': showSource }"
      :style="{ anchorName: toolbarAnchor, '--drawing-toolbar-anchor': toolbarAnchor }"
    >
      <div
        v-if="showSource"
        class="drawing-view-tabs"
        role="tablist"
        :aria-label="name"
      >
        <button
          v-for="view in views"
          :id="viewId + '-tab-' + view"
          :key="view"
          type="button"
          role="tab"
          :aria-controls="viewId + '-panel-' + view"
          :aria-selected="activeView === view"
          :tabindex="activeView === view ? 0 : -1"
          @click="selectView(view)"
          @keydown.left.prevent="switchView"
          @keydown.right.prevent="switchView"
        >
          {{ t('drawing.' + view) }}
        </button>
      </div>
      <div
        v-if="activeView === 'canvas' && (!openInTab || hasFilenameInput || canInsert || canSave)"
        class="drawing-actions drawing-file-actions"
      >
        <label
          v-if="hasFilenameInput"
          class="drawing-filename"
        >
          <input
            v-model="filename"
            type="text"
            :aria-label="t('drawing.filename')"
            :placeholder="`${t('drawing.untitled')}.excalidraw`"
            :disabled="!canEdit"
          >
        </label>
        <span
          v-else-if="!openInTab"
          class="drawing-filename"
        >{{ file?.filename ?? session?.title }}</span>
        <el-button
          v-if="canInsert"
          :disabled="!canEdit"
          @click="commitDrawing('insert')"
        >
          {{ t('drawing.insertIntoNote') }}
        </el-button>
        <el-button
          v-if="canSave"
          type="primary"
          :disabled="!canEdit"
          @click="commitDrawing('save')"
        >
          {{ t(session?.draft && session.noteId ? 'drawing.insertIntoNote' : 'menu.file.save') }}
        </el-button>
      </div>
      <div
        v-show="activeView === 'canvas'"
        class="drawing-actions drawing-toolbar-actions"
      >
        <el-button
          ref="addDocumentButton"
          :style="{ anchorName: documentPanelAnchor }"
          :disabled="!canEdit"
          :title="t('drawing.addDocument')"
          :popovertarget="documentPanelId"
          :aria-expanded="documentPanelOpen"
          :aria-controls="documentPanelId"
        >
          {{ t('drawing.addDocumentButton') }}
          <el-icon
            class="drawing-picker-arrow"
            aria-hidden="true"
          >
            <ArrowDown />
          </el-icon>
        </el-button>
        <el-button
          v-if="openInTab"
          :disabled="!ready || busy"
          :icon="TopRight"
          @click="moveToTab"
        >
          {{ t('drawing.openInTab') }}
        </el-button>
      </div>
      <div
        :id="documentPanelId"
        ref="documentPanel"
        class="drawing-document-panel"
        :style="{ positionAnchor: documentPanelAnchor }"
        popover="auto"
        role="group"
        :aria-label="t('drawing.addDocumentButton')"
        @beforetoggle="updateDocumentPanel"
        @toggle="focusDocumentPicker"
        @keydown.esc.capture.stop.prevent="closeDocumentPanel"
      >
        <form
          v-if="card"
          class="drawing-card-options"
          @submit.prevent="insertCard"
        >
          <label
            :for="viewId + '-card-section'"
            :title="windowPath.basename(card.path)"
          >{{ windowPath.basename(card.path) }}</label>
          <select
            :id="viewId + '-card-section'"
            ref="cardSection"
            v-model="heading"
          >
            <option value="">
              {{ t('drawing.wholeDocument') }}
            </option>
            <option
              v-for="item in card.document.headings"
              :key="item.githubSlug"
              :value="item.githubSlug"
            >
              {{ item.content }}
            </option>
          </select>
          <div class="drawing-actions drawing-document-panel-actions">
            <el-button native-type="submit">
              {{ t('drawing.addCard') }}
            </el-button>
            <el-button @click="closeDocumentPanel">
              {{ t('common.cancel') }}
            </el-button>
          </div>
        </form>
        <div
          v-else-if="documentPanelOpen"
          class="drawing-document-picker"
        >
          <el-select-v2
            ref="documentPicker"
            class="drawing-document-search"
            :options="documentOptions"
            :disabled="!canEdit"
            :aria-label="t('drawing.searchDocuments')"
            :placeholder="t('drawing.searchDocuments')"
            :no-data-text="t('commandPalette.noResults')"
            :no-match-text="t('commandPalette.noResults')"
            :teleported="false"
            filterable
            automatic-dropdown
            default-first-option
            @update:model-value="prepareCard"
          >
            <template #default="{ item }">
              <div
                class="drawing-document-option"
                :title="item.value"
              >
                <span>{{ windowPath.basename(item.value) }}</span>
                <span>{{ windowPath.dirname(item.label) }}</span>
              </div>
            </template>
          </el-select-v2>
          <div class="drawing-actions drawing-document-panel-actions">
            <el-button
              :disabled="!canEdit"
              @click="pickDocument"
            >
              {{ t('drawing.browseDocuments') }}
            </el-button>
            <el-button @click="closeDocumentPanel">
              {{ t('common.cancel') }}
            </el-button>
          </div>
        </div>
      </div>
    </div>
    <p
      v-if="error || (activeView === 'source' && sourceError)"
      class="drawing-error"
      role="alert"
    >
      {{ activeView === 'source' && sourceError ? sourceError : error }}
    </p>
    <div
      v-show="activeView === 'canvas'"
      :id="showSource ? viewId + '-panel-canvas' : undefined"
      class="drawing-view"
      :role="showSource ? 'tabpanel' : undefined"
      :aria-labelledby="showSource ? viewId + '-tab-canvas' : undefined"
    >
      <div
        ref="canvas"
        class="drawing-canvas"
        @dragover.capture="allowDocumentDrop"
        @drop.capture="dropDocument"
        @dblclick.capture="openSelectedDocument"
      />
    </div>
    <div
      v-if="showSource"
      v-show="activeView === 'source'"
      :id="viewId + '-panel-source'"
      role="tabpanel"
      :aria-labelledby="viewId + '-tab-source'"
      class="drawing-view drawing-source"
    >
      <div class="drawing-actions">
        <label :for="viewId + '-source-json'">Excalidraw JSON</label>
        <el-button @click="copySource">
          {{ t('menu.edit.copy') }}
        </el-button>
      </div>
      <textarea
        :id="viewId + '-source-json'"
        v-model="sourceDraft"
        :readonly="readOnly || busy"
        spellcheck="false"
        autocapitalize="off"
        wrap="off"
        @input="sourceError = ''"
      />
      <div
        v-if="!readOnly"
        class="drawing-actions"
      >
        <span>{{ sourceDirty ? t('embeddedImage.dirty') : '' }}</span>
        <el-button
          :disabled="!sourceDirty || busy"
          @click="resetSource"
        >
          {{ t('embeddedImage.discard') }}
        </el-button>
        <el-button
          type="primary"
          :disabled="!sourceDirty || !api || busy"
          @click="applySource"
        >
          {{ t('embeddedImage.apply') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import '@/services/drawingFonts'
import '@excalidraw/excalidraw/index.css'
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, languages, newElementWith, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { FileId } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { ArrowDown, TopRight } from '@element-plus/icons-vue'
import { ElMessageBox, type ButtonInstance } from 'element-plus'
import { t } from '@/i18n'
import { getSessionActions, useEditorStore } from '@/store/editor'
import type { IFileState } from '@shared/types/files'
import type { RecentDocument } from '@shared/types/ipc'
import { usePreferencesStore } from '@/store/preferences'
import { useProjectStore } from '@/store/project'
import type { TreeFolderNode } from '@/components/sideBar/types'
import { isDarkThemeId } from 'common/theme'
import bus from '@/bus'
import type { DrawingEditor } from '@/services/drawingEditors'
import {
  documentReference,
  makeDocumentCard,
  readCardDocument,
  parseDrawing,
  referenceForCard,
  referencedDocument,
  refreshDocumentCards,
  serializeDrawing,
  type DrawingScene
} from '@/services/drawingScene'

const props = defineProps<{
  file?: IFileState
  session?: DrawingEditor
  showSource?: boolean
  openInTab?: () => Promise<void>
  inserted?: () => void
  canInsert?: boolean
  insert?: (path: string, content?: string) => Promise<boolean>
}>()
const session = props.session
const filename = ref(session?.filename ?? '')
const windowPath = window.path
const pathname = computed(() => props.file?.pathname ?? props.session?.pathname)
const readOnly = computed(() => props.file?.readOnly ?? props.session?.readOnly ?? false)
const name = computed(() => props.file?.filename ?? props.session?.title ?? t('drawing.embedded'))
const editor = useEditorStore()
const preferences = usePreferencesStore()
const project = useProjectStore()
const canvas = ref<HTMLDivElement | null>(null)
const api = shallowRef<ExcalidrawImperativeAPI | null>(null)
const ready = ref(false)
const card = shallowRef<{ path: string; document: Awaited<ReturnType<typeof readCardDocument>>; point?: { x: number; y: number } } | null>(null)
const heading = ref('')
const busy = ref(false)
const canEdit = computed(() => ready.value && !busy.value && !readOnly.value)
const canSave = computed(() => !readOnly.value && (!session?.noteId || session.draft))
const hasFilenameInput = computed(() => session?.draft && session.nameOnInsert)
const error = ref('')
const viewId = useId()
const views = ['canvas', 'source'] as const
const activeView = ref<(typeof views)[number]>('canvas')
const sourceDraft = ref('')
const sourceBaseline = ref('')
const sourceError = ref('')
const sourceDirty = computed(() => sourceDraft.value !== sourceBaseline.value)
const toolbarAnchor = '--drawing-toolbar-' + viewId
const documentPanelId = viewId + '-document-picker'
const documentPanelAnchor = '--drawing-document-' + viewId
const documentPanel = ref<HTMLElement>()
const documentPanelOpen = ref(false)
const addDocumentButton = ref<ButtonInstance>()
const documentPicker = ref<{ focus: () => void }>()
const cardSection = ref<HTMLSelectElement>()
const recentDocuments = shallowRef<RecentDocument[]>([])
const documentOptions = computed(() => {
  const folderPaths: string[] = []
  function collect(folder: TreeFolderNode) {
    for (const file of folder.files) if (file.isMarkdown) folderPaths.push(file.pathname)
    for (const child of folder.folders) collect(child)
  }
  for (const root of project.availableRoots) collect(root.tree)

  const seen = new Set<string>()
  function group(label: string, paths: string[]) {
    const options = []
    for (const path of paths) {
      if (!window.fileUtils.hasMarkdownExtension(path)) continue
      const key = windowPath.normalize(path)
      if (seen.has(key)) continue
      seen.add(key)
      options.push({ label: project.FILE_LABEL(path).replaceAll('\\', '/'), value: path })
    }
    return { label, options }
  }

  const openPaths = editor.tabs.filter(tab => !tab.isPendingCreation && !tab.diskMissing).map(tab => tab.pathname)
  const recentPaths = recentDocuments.value.filter(item => !item.isDirectory).map(item => item.pathname)
  return [
    group(t('sideBar.tree.openedFiles'), openPaths),
    group(t('commandPalette.recentlyOpened'), recentPaths),
    group(t('sideBar.tree.folders'), folderPaths)
  ].filter(group => group.options.length)
})
const language = computed(() => {
  const locale = preferences.language
  return languages.find(item => item.code.toLowerCase() === locale.toLowerCase())?.code ??
    languages.find(item => item.code === locale.split('-')[0])?.code ?? 'en'
})
const theme = computed(() => isDarkThemeId(preferences.theme) ? 'dark' : 'light')
let root: Root | undefined
let baseline: string | undefined
let incoming = props.file?.markdown ?? props.session?.source ?? ''
let disposed = false
let refreshVersion = 0
let dirtyTimer: ReturnType<typeof setTimeout> | undefined
let pendingSave: Promise<boolean> | undefined
let saveFailed = false
let discarded: { transactionId: string; content: string } | undefined
let cardRequest = 0

function currentScene(): DrawingScene | undefined {
  const current = api.value
  if (current) return { elements: current.getSceneElements(), appState: current.getAppState(), files: current.getFiles() }
}

function readSource() {
  const scene = ready.value && currentScene()
  const content = scene ? serializeDrawing(scene) : undefined
  return content !== undefined && content !== baseline ? content : session?.source ?? ''
}

function resetSource() {
  sourceDraft.value = sourceBaseline.value = readSource()
  sourceError.value = ''
}

function selectView(view: (typeof views)[number]) {
  if (view === 'source') {
    documentPanel.value?.hidePopover()
    if (!sourceDirty.value) resetSource()
  }
  activeView.value = view
}

async function switchView(event: KeyboardEvent) {
  const tab = event.currentTarget as HTMLButtonElement
  const next = activeView.value === 'canvas' ? 'source' : 'canvas'
  selectView(next)
  await nextTick()
  tab.parentElement?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
}

async function copySource() {
  try {
    await window.electron.clipboard.writeText(sourceDraft.value)
  } catch {
    sourceError.value = t('embeddedImage.copyFailed')
  }
}

async function applySource() {
  const current = api.value
  if (!current || !session || readOnly.value || busy.value || !sourceDirty.value) return
  if (readSource() !== sourceBaseline.value) {
    sourceError.value = t('drawing.sourceChanged')
    return
  }
  const draft = sourceDraft.value
  busy.value = true
  error.value = ''
  sourceError.value = ''
  try {
    const scene = await parseDrawing(draft)
    if (disposed || readOnly.value) return
    if (readSource() !== sourceBaseline.value) {
      sourceError.value = t('drawing.sourceChanged')
      return
    }
    current.addFiles(Object.values(scene.files))
    current.updateScene({
      elements: scene.elements,
      appState: { ...current.getAppState(), ...scene.appState, selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    ready.value = true
  } catch (reason) {
    sourceError.value = t('drawing.invalidSource', { reason: String(reason) })
    return
  } finally {
    busy.value = false
  }
  if (!session.draft) await saveSession(false)
  sourceDraft.value = sourceBaseline.value = readSource()
}

async function confirmSourceDiscard() {
  if (!sourceDirty.value) return true
  try {
    await ElMessageBox.confirm(t('drawing.discardSource'), {
      confirmButtonText: t('drawing.discard'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
    return true
  } catch {
    return false
  }
}

function syncDrawing() {
  const file = props.file
  if (!file || !ready.value || file.readOnly) return
  const scene = currentScene()
  if (!scene) return
  const content = serializeDrawing(scene)
  if (content === baseline) return
  baseline = content
  if (content === file.markdown) return
  incoming = content
  editor.UPDATE_DRAWING(file.id, content)
}

function scheduleSessionSave() {
  clearTimeout(dirtyTimer)
  dirtyTimer = setTimeout(() => { void saveSession(false) }, 350)
}

const initialData = (async() => {
  try {
    const scene = await parseDrawing(incoming)
    return props.file?.pathname ? await refreshDocumentCards(scene, props.file.pathname) : scene
  } catch (reason) {
    error.value = t('drawing.openFailed', { reason: String(reason) })
    return null
  }
})()

watch([canvas, theme, language, name, readOnly], ([container, activeTheme, langCode, drawingName, locked]) => {
  if (!container) return
  root ??= createRoot(container)
  root.render(createElement(Excalidraw, {
    initialData,
    theme: activeTheme,
    langCode,
    name: drawingName,
    viewModeEnabled: locked || undefined,
    autoFocus: true,
    handleKeyboardGlobally: false,
    validateEmbeddable: false,
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } },
    excalidrawAPI: (instance: ExcalidrawImperativeAPI) => { api.value = instance },
    onChange: (_elements, state) => {
      if (state.isLoading) return
      if (!ready.value) void initialData.then(initial => {
        const scene = currentScene()
        if (!initial || disposed || !scene || ready.value) return
        baseline = serializeDrawing(scene)
        ready.value = true
      })
      if (props.file) {
        clearTimeout(dirtyTimer)
        dirtyTimer = setTimeout(syncDrawing, 120)
      } else if (props.session?.noteId && !props.session.draft && !readOnly.value) {
        scheduleSessionSave()
      }
    },
    onLinkOpen: (element, event) => {
      const reference = documentReference(element)
      if (!reference) return
      event.preventDefault()
      openReferencedDocument(reference)
    }
  }))
}, { flush: 'post' })

watch(() => props.file?.markdown, async content => {
  const current = api.value
  if (!current || content === undefined || content === incoming) return
  try {
    const scene = await parseDrawing(content)
    const chosen = pathname.value ? await refreshDocumentCards(scene, pathname.value) : scene
    if (disposed || props.file?.markdown !== content) return
    incoming = content
    current.resetScene()
    current.addFiles(Object.values(chosen.files))
    current.updateScene({
      elements: chosen.elements,
      appState: { ...current.getAppState(), ...chosen.appState },
      captureUpdate: CaptureUpdateAction.NEVER
    })
    const live = currentScene()
    if (live) baseline = serializeDrawing(live)
  } catch (reason) { error.value = t('drawing.openFailed', { reason: String(reason) }) }
})

onMounted(() => {
  window.addEventListener('focus', refreshCards)
  bus.on('flush-active-editor', syncDrawing)
  if (session) {
    session.save = () => saveSession(true)
    session.beforeClose = beforeClose
  }
})
onBeforeUnmount(() => {
  disposed = true
  bus.off('flush-active-editor', syncDrawing)
  window.removeEventListener('focus', refreshCards)
  clearTimeout(dirtyTimer)
  if (session?.beforeClose === beforeClose) {
    session.save = undefined
    session.beforeClose = undefined
  }
  root?.unmount()
})

async function refreshCards() {
  const file = props.file
  const current = api.value
  const before = currentScene()
  if (!current || !before || busy.value || !file?.pathname || editor.currentFile?.id !== file.id) return
  const revision = ++refreshVersion
  const refreshed = await refreshDocumentCards(before, file.pathname)
  if (disposed || api.value !== current || busy.value || revision !== refreshVersion) return
  const original = new Set(before.elements)
  const replacements: BinaryFileData[] = []
  const elements = current.getSceneElementsIncludingDeleted().map(element => {
    if (element.type !== 'image' || !element.fileId || !original.has(element)) return element
    const file = refreshed.files[element.fileId]
    if (!file || file === before.files[element.fileId]) return element
    const id = crypto.randomUUID() as FileId
    replacements.push({ ...file, id })
    return newElementWith(element, { fileId: id })
  })
  if (!replacements.length) return
  const wasSaved = file.isSaved
  current.addFiles(replacements)
  current.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER })
  const scene = currentScene()
  if (scene && wasSaved) baseline = serializeDrawing(scene)
  syncDrawing()
}

async function saveSession(explicit: boolean): Promise<boolean> {
  clearTimeout(dirtyTimer)
  while (pendingSave) {
    const saved = await pendingSave
    if (!saved) return false
  }
  const scene = currentScene()
  if (!session || !scene || !ready.value || readOnly.value || disposed) return true
  if (!explicit && session.draft) return true
  const content = serializeDrawing(scene)
  if (!session.draft && content === baseline && !saveFailed) return true
  const wasDraft = session.draft
  busy.value = true
  error.value = ''
  const save = async() => {
    try {
      const saved = await session.commit(content, filename.value)
      if (!saved) return false
      session.source = content
      baseline = content
      saveFailed = false
      if (wasDraft && session.noteId) {
        const latest = currentScene()
        if (latest && serializeDrawing(latest) !== content) scheduleSessionSave()
        else props.inserted?.()
      }
      return true
    } catch (reason) {
      saveFailed = true
      error.value = t('drawing.saveFailed', { reason: String(reason) })
      return false
    } finally {
      busy.value = false
      pendingSave = undefined
    }
  }
  pendingSave = save()
  return pendingSave
}

async function moveToTab() {
  const session = props.session
  if (!session || !props.openInTab) return
  const discardSource = await confirmSourceDiscard()
  if (!discardSource) return
  if (session.noteId && !session.draft && !readOnly.value) {
    const saved = await saveSession(false)
    if (!saved) return
  }
  const scene = currentScene()
  if (!scene) return
  const content = serializeDrawing(scene)
  if (session.draft) {
    session.dirtyDraft ||= content !== baseline
    session.filename = filename.value
  }
  session.source = content
  try {
    await props.openInTab()
  } catch (reason) {
    error.value = t('drawing.openFailed', { reason: String(reason) })
  }
}

async function commitDrawing(action: 'save' | 'insert') {
  if (!canEdit.value) return
  if (props.session) {
    if (props.session.draft && props.session.noteId) {
      const discardSource = await confirmSourceDiscard()
      if (!discardSource) return
    }
    await saveSession(true)
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (action === 'insert' && preferences.embedDrawings) {
      const scene = currentScene()
      if (!scene) return
      const content = serializeDrawing(scene)
      await props.insert?.(pathname.value ?? '', content)
      return
    }
    const file = props.file
    if (!file) return
    syncDrawing()
    const saved = await getSessionActions()?.save(file.id)
    if (saved?.status !== 'saved') return
    bus.emit('drawing::preview-changed')
    if (action === 'insert') await props.insert?.(saved.pathname)
  } catch (reason) {
    error.value = t('drawing.saveFailed', { reason: String(reason) })
  } finally {
    busy.value = false
  }
}

async function beforeClose(transactionId?: string): Promise<boolean> {
  if (!session || readOnly.value) return true
  if (busy.value && !pendingSave) return false
  const discardSource = await confirmSourceDiscard()
  if (!discardSource) return false
  const pending = pendingSave ? await pendingSave : true
  if (pending && session.noteId && !session.draft) {
    const saved = await saveSession(false)
    if (saved) return true
  }
  const scene = currentScene()
  const content = scene && serializeDrawing(scene)
  if (pending && !session.dirtyDraft && (content === undefined || baseline === undefined || content === baseline)) return true
  if (transactionId && discarded?.transactionId === transactionId && discarded.content === content) return true
  try {
    await ElMessageBox.confirm(t('drawing.discardChanges'), {
      confirmButtonText: t('drawing.discard'),
      cancelButtonText: t('common.cancel'),
      type: 'warning'
    })
    if (transactionId && content !== undefined) discarded = { transactionId, content }
    return true
  } catch {
    return false
  }
}

defineExpose({ beforeClose })

function handleShortcut(event: KeyboardEvent) {
  if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  event.stopPropagation()
  if (activeView.value === 'source') void applySource()
  else void commitDrawing('save')
}

function openReferencedDocument(reference: NonNullable<ReturnType<typeof documentReference>>) {
  if (!pathname.value) return
  const path = referencedDocument(pathname.value, reference)
  window.electron.ipcRenderer.send('mt::open-file', path, { anchor: reference.heading })
}

function openSelectedDocument(event: MouseEvent) {
  const current = api.value
  if (!current || !(event.target instanceof HTMLCanvasElement)) return
  const selected = current.getAppState().selectedElementIds
  const elements = current.getSceneElements().filter(element => selected[element.id])
  const reference = elements.length === 1 ? documentReference(elements[0]) : undefined
  if (!reference) return
  event.preventDefault()
  event.stopPropagation()
  openReferencedDocument(reference)
}

async function prepareCard(path: string, point?: { x: number; y: number }) {
  if (!window.fileUtils.hasMarkdownExtension(path)) return
  const request = ++cardRequest
  card.value = null
  error.value = ''
  try {
    if (props.file && !pathname.value) await commitDrawing('save')
    if ((props.file && !pathname.value) || disposed) return
    const document = await readCardDocument(path)
    if (disposed || request !== cardRequest || activeView.value !== 'canvas') return
    heading.value = ''
    card.value = { path, document, point }
    documentPanel.value?.showPopover({ source: addDocumentButton.value?.ref })
    await nextTick()
    cardSection.value?.focus()
  } catch (reason) {
    if (request === cardRequest) error.value = t('drawing.openFailed', { reason: String(reason) })
  }
}

function updateDocumentPanel(event: ToggleEvent) {
  documentPanelOpen.value = event.newState === 'open'
  if (!documentPanelOpen.value) {
    cardRequest++
    card.value = null
  }
}

async function focusDocumentPicker(event: ToggleEvent) {
  if (event.newState !== 'open' || card.value) return
  documentPicker.value?.focus()
  recentDocuments.value = await window.electron.ipcRenderer.invoke('mt::get-recently-used-documents').catch(() => [])
}

function closeDocumentPanel() {
  documentPanel.value?.hidePopover()
  addDocumentButton.value?.ref?.focus()
}

async function pickDocument() {
  try {
    const defaultPath = pathname.value ? windowPath.dirname(pathname.value) : project.GET_DEFAULT_DIRECTORY()
    const path = await window.electron.dialog.showOpenFile({
      title: t('drawing.addDocument'),
      defaultPath: defaultPath || undefined,
      filters: [{ name: 'Markdown', extensions: window.fileUtils.MARKDOWN_INCLUSIONS.map(pattern => pattern.replace(/^\*\./, '')) }]
    })
    if (path && documentPanelOpen.value) await prepareCard(path)
  } catch (reason) {
    error.value = t('drawing.openFailed', { reason: String(reason) })
  }
}

function allowDocumentDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}

function dropDocument(event: DragEvent) {
  if (!canEdit.value) return
  const file = event.dataTransfer?.files[0]
  if (!file || !window.fileUtils.hasMarkdownExtension(file.name)) return
  const path = window.electron.webUtils.getPathForFile(file)
  if (!path) return
  event.preventDefault()
  event.stopPropagation()
  void prepareCard(path, { x: event.clientX, y: event.clientY })
}

function insertCard() {
  const current = api.value
  const pending = card.value
  if (!current || !pending || !canEdit.value) return
  try {
    const selected = heading.value || undefined
    const reference = pathname.value ? referenceForCard(pathname.value, pending.path, selected) : undefined
    const fileId = crypto.randomUUID() as FileId
    const { file, width, height } = makeDocumentCard(pending.document, pending.path, fileId, selected)
    const state = current.getAppState()
    const point = pending.point ?? { x: state.offsetLeft + state.width / 2, y: state.offsetTop + state.height / 2 }
    const { x, y } = viewportCoordsToSceneCoords({ clientX: point.x, clientY: point.y }, state)
    const [element] = convertToExcalidrawElements([{
      type: 'image', x: x - width / 2, y: y - height / 2, width, height, fileId,
      status: 'saved',
      ...(reference ? {
        link: `${encodeURI(reference.path)}${selected ? '#' + encodeURIComponent(selected) : ''}`,
        customData: { autumnmarkDocument: reference }
      } : {})
    }])
    current.addFiles([file])
    current.updateScene({
      elements: [...current.getSceneElementsIncludingDeleted(), element],
      appState: { selectedElementIds: { [element.id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
    closeDocumentPanel()
    syncDrawing()
  } catch (reason) {
    error.value = t('drawing.cardFailed', { reason: String(reason) })
  }
}
</script>

<style>
.drawing-workspace, .drawing-canvas {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.drawing-workspace {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--editorBgColor);
}
.drawing-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.drawing-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.drawing-toolbar-with-tabs {
  min-height: 36px;
  border-bottom: 1px solid var(--floatBorderColor);
}
.drawing-view-tabs {
  display: flex;
  align-self: stretch;
  gap: 4px;
}
.drawing-file-actions {
  flex: 1 1 auto;
  min-width: 0;
}
.drawing-toolbar-actions {
  margin-inline-start: auto;
}
.drawing-picker-arrow {
  margin-inline-start: 4px;
}
.drawing-view-tabs button {
  padding: 6px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--editorColor);
  font: inherit;
  cursor: pointer;
}
.drawing-view-tabs button[aria-selected='true'] {
  border-bottom-color: var(--themeColor);
}
.drawing-source textarea {
  flex: 1;
  min-height: 0;
  padding: 10px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 6px;
  background: var(--inputBgColor);
  color: var(--editorColor);
  font: 13px/1.5 var(--editorFontFamilyMono, monospace);
  resize: none;
}
.drawing-source .drawing-actions {
  justify-content: flex-end;
  color: var(--editorColor);
}
.drawing-source .drawing-actions > :first-child {
  margin-right: auto;
}
.drawing-document-panel {
  --drawing-document-panel-width: min(32rem, anchor-size(var(--drawing-toolbar-anchor) width));
  position: fixed;
  inset: auto;
  top: anchor(bottom);
  right: min(
    anchor(right),
    calc(anchor(var(--drawing-toolbar-anchor) left) - var(--drawing-document-panel-width))
  );
  box-sizing: border-box;
  width: var(--drawing-document-panel-width);
  margin: 6px 0 0;
  padding: 10px;
  overflow: visible;
  border: 1px solid var(--floatBorderColor);
  border-radius: 8px;
  background: var(--floatBgColor);
  color: var(--editorColor);
  box-shadow: var(--floatShadow);
}
.drawing-document-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.drawing-card-options {
  display: grid;
  gap: 8px;
}
.drawing-document-panel-actions {
  justify-content: flex-end;
}
.drawing-document-search {
  flex: 1;
  min-width: 0;
}
.drawing-document-option {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.drawing-document-option span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.drawing-document-option span:first-child {
  flex-shrink: 0;
  max-width: 60%;
}
.drawing-document-option span:last-child {
  font-size: 0.88em;
  color: var(--editorColor60);
}
.drawing-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.drawing-workspace .el-button + .el-button {
  margin-left: 0;
}
.drawing-filename {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-right: auto;
  color: var(--editorColor);
}
span.drawing-filename {
  display: block;
  max-width: min(30rem, 50vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drawing-filename input {
  box-sizing: border-box;
  width: min(18rem, 48vw);
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  background: var(--inputBgColor);
  color: inherit;
  font: inherit;
}
.drawing-filename input:focus {
  outline: 1px solid var(--themeColor);
}
.drawing-card-options label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drawing-card-options select {
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--floatBorderColor);
  border-radius: 4px;
  color: inherit;
  background: var(--inputBgColor);
}
.drawing-error {
  margin: 0;
  color: var(--editorColor);
}
.drawing-canvas {
  position: relative;
  border: 1px solid var(--floatBorderColor);
  border-radius: 8px;
  overflow: hidden;
}
</style>
