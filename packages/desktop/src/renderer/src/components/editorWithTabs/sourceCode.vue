<template>
  <div
    ref="sourceCodeContainer"
    class="source-code"
    @scroll.passive="handleScroll"
    @contextmenu.capture="showContextMenu"
    @paste.capture="pasteEmbeddedImage"
    @drop.capture="dropEmbeddedImage"
    @copy.capture="copyVideoSelection"
    @cut.capture="copyVideoSelection"
    @dragstart="expandVideoDrag"
  />
</template>

<script setup lang="ts">
import {
  registerSourceView,
  captureSourceHistory,
  restoreSourceHistory
} from '../../services/documentMode'
import { ref, shallowRef, markRaw, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

import { registerSourceViewState, documentViewChanged } from '@/services/documentViewState'
import { scrollSourceEditorToLine } from '@/util/sourceModeToc'
import { sectionEdit, type BeginOutlineMove } from '@/util/outlineMove'
import type { HeadingLinkRequest } from '@/util/headingLinks'
import { getMarkdownOutline, headingLinkAt } from '@muyajs/core'
import { storeToRefs } from 'pinia'
import type CodeMirror from 'codemirror'
import codeMirror, { setCursorAtFirstLine, setTextDirection } from '../../codeMirror'
import { embeddedImageDestination, findPastedImageSources, getClipboardImageFile, imageDocumentMarkdown, standaloneImageSource, imageToMarkdown } from '@muyajs/core'
import type { IEmbeddedImageEdit } from '@muyajs/core'
import { installEmbeddedImages } from '../../codeMirror/embeddedImages'
import { embedImage, readClipboardImage } from '@/util/embedImage'
import { embedDocumentImages } from '@/services/pastedImages'
import { videoFromTransfer } from '@muyajs/core'
import { pickVideo, savedVideoDocument, videoMarkdown } from '@/util/video'
import { documentVideos } from '@/util/videoAttachments'
import notice from '@/services/notification'
import { adjustCursor, isWindows } from '../../util'
import { getSourceExtraKeys } from '../../codeMirror/keybindings'
import bus from '../../bus'
import { t } from '@/i18n'
import { getDocumentLocationMenuItems } from '@/contextMenu/fileLocation'
import { isDocumentBackground } from '@/contextMenu/documentBackground'
import type { MediaEditor } from '@/services/batchMedia'
import { popupContextMenu, type ContextMenuItem } from '@/contextMenu/popupMenu'
import { oneDarkThemes, railscastsThemes, themeBaseId } from 'common/theme'

interface MuyaIndexCursorLike {
  anchor: CodeMirror.Position
  focus: CodeMirror.Position
}

const emit = defineEmits<{ editEmbeddedImage: [image: IEmbeddedImageEdit, event?: MouseEvent]; headingLink: [request: HeadingLinkRequest | null] }>()
const props = defineProps<{
  imageMenuItem: ContextMenuItem
  markdown?: string
  muyaIndexCursor?: unknown
  textDirection: string
}>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const sourceCodeContainer = ref<HTMLDivElement | null>(null)

const editor = shallowRef<CodeMirror.Editor | null>(null)
const viewDestroyed = ref(false)
const tabId = ref<string | null>(null)
let resizeObserver: ResizeObserver | undefined
let releaseViewState: (() => void) | undefined
let releaseEmbeddedImages: (() => void) | undefined

const {
  theme,
  sourceCode,
  sourceCodeLineNumbers,
  texMathDollars,
  texMathGfm,
  texMathSingleBackslash,
  texMathDoubleBackslash
} = storeToRefs(preferencesStore)
const { currentFile: currentTab } = storeToRefs(editorStore)

function transferredImage(data: DataTransfer | null): File | string | null | undefined {
  if (!data) return
  return standaloneImageSource(data.getData('text/html'), data.getData('text/uri-list') || data.getData('text/plain')) ?? getClipboardImageFile(data)
}

async function insertMarkup(load: () => Promise<string>, position?: CodeMirror.Position, errorKey = 'embeddedImage.invalid') {
  const cm = editor.value
  const tab = currentTab.value
  if (!cm || !tab || tab.readOnly) return
  const from = cm.setBookmark(position ?? cm.getCursor('from'))
  const to = cm.setBookmark(position ?? cm.getCursor('to'))
  try {
    const markup = await load()
    if (!markup) return
    const start = from.find()
    const end = to.find()
    if (start && end && editor.value === cm && !viewDestroyed.value && tabId.value === tab.id && !currentTab.value?.readOnly) {
      cm.replaceRange(markup, start, end, 'embedded-media')
    }
  } catch {
    void notice.notify({ title: t(errorKey), type: 'error' })
  } finally {
    from.clear()
    to.clear()
  }
}

function insertEmbeddedImage(image: File | string, position?: CodeMirror.Position) {
  const path = currentTab.value?.pathname
  return insertMarkup(async() => {
    const src = await embedImage(image, path)
    const alt = typeof image === 'string' ? '' : image.name.replace(/[\\[\]]/g, '\\$&')
    return imageToMarkdown({ src, alt })
  }, position)
}

function insertVideo(input: File | string | Promise<string>, position?: CodeMirror.Position) {
  const path = savedVideoDocument(currentTab.value)
  const videos = currentTab.value && documentVideos(currentTab.value.id)
  return insertMarkup(async() => {
    const file = await input
    return file ? videoMarkdown(file, path, videos) : ''
  }, position, 'video.invalid')
}

function handleVideoFormat(type: unknown) {
  if (type === 'video' && sourceCode.value && !currentTab.value?.readOnly) void insertVideo(pickVideo())
}

function copyVideoSelection(event: ClipboardEvent) {
  const cm = editor.value
  if (!cm || !tabId.value || !event.clipboardData) return
  const selected = cm.somethingSelected()
  if (!selected && !cm.getOption('lineWiseCopyCut')) return
  const ranges = cm.listSelections().map(({ anchor, head }) => selected ? { anchor, head } : {
    anchor: { line: head.line, ch: 0 }, head: { line: head.line + 1, ch: 0 }
  })
  const text = selected ? cm.getSelection() : ranges.map(r => cm.getRange(r.anchor, r.head)).join('\n')
  const expanded = documentVideos(tabId.value).externalText(text)
  if (expanded === text) return
  event.preventDefault()
  event.stopPropagation()
  event.clipboardData.setData('text/plain', expanded)
  if (event.type === 'cut' && !cm.getOption('readOnly')) {
    cm.operation(() => {
      if (!selected) cm.setSelections(ranges)
      cm.replaceSelections(cm.listSelections().map(() => ''), 'start', 'cut')
    })
  }
}

function expandVideoDrag(event: DragEvent) {
  if (!event.dataTransfer || !tabId.value) return
  const text = event.dataTransfer.getData('text/plain')
  const expanded = documentVideos(tabId.value).externalText(text)
  if (text !== expanded) event.dataTransfer.setData('text/plain', expanded)
}

async function pasteImageDocument(text: string) {
  const cm = editor.value
  const tab = currentTab.value
  if (!cm || !tab || tab.readOnly || cm.getOption('readOnly')) return
  const markdown = documentVideos(tab.id).compact(text.replace(/\r\n?/g, '\n'))
  cm.replaceSelection(markdown, 'end', 'paste')
  const ends = cm.listSelections().map(selection => cm.indexFromPos(selection.head))
  const pasted = cm.getValue()
  const images = findPastedImageSources(pasted).filter(image =>
    ends.some(end => image.start >= end - markdown.length && image.end <= end))
  if (!images.length) return
  const targets = images.map(image => ({
    image,
    marker: cm.markText(cm.posFromIndex(image.start), cm.posFromIndex(image.end))
  }))
  try {
    const converted = await embedDocumentImages(images.map(image => image.src), tab)
    if (viewDestroyed.value || editor.value !== cm || tabId.value !== tab.id || currentTab.value?.readOnly) return
    const live = cm.getValue()
    const destinations = live === pasted ? null : new Map(findPastedImageSources(live).map(item => [item.start, item]))
    cm.operation(() => {
      for (const { marker, image } of targets.reverse()) {
        const range = marker.find()
        const src = converted.get(image.src)
        if (!range || !src || cm.getRange(range.from, range.to) !== pasted.slice(image.start, image.end)) continue
        const destination = destinations ? destinations.get(cm.indexFromPos(range.from)) : image
        if (destination?.src !== image.src) continue
        cm.replaceRange(embeddedImageDestination(destination, src), range.from, range.to, 'embed-pasted-images')
      }
    })
    // Patches on earlier lines can leave the caret stationary, so cursorActivity may never publish them.
    saveContent(cm)
  } finally {
    for (const { marker } of targets) marker.clear()
  }
}

function pasteEmbeddedImage(event: ClipboardEvent) {
  const video = videoFromTransfer(event.clipboardData)
  if (video) {
    event.preventDefault()
    event.stopPropagation()
    void insertVideo(video)
    return
  }
  if (preferencesStore.imageInsertAction !== 'embed') return
  const transfer = event.clipboardData
  const markdown = transfer && imageDocumentMarkdown(transfer.getData('text/plain'), transfer.getData('text/html'),
    getClipboardImageFile(transfer), preferencesStore.bulletListMarker)
  if (markdown) {
    event.preventDefault()
    event.stopPropagation()
    void pasteImageDocument(markdown)
    return
  }
  const image = transferredImage(event.clipboardData)
  if (!image) return
  event.preventDefault()
  event.stopPropagation()
  void insertEmbeddedImage(image)
}

function dropEmbeddedImage(event: DragEvent) {
  if (!editor.value) return
  const video = videoFromTransfer(event.dataTransfer)
  const image = preferencesStore.imageInsertAction === 'embed' ? transferredImage(event.dataTransfer) : null
  if (!video && !image) return
  event.preventDefault()
  event.stopPropagation()
  const position = editor.value.coordsChar({ left: event.clientX, top: event.clientY }, 'window')
  if (video) void insertVideo(video, position)
  else if (image) void insertEmbeddedImage(image, position)
}

const applyMediaEdits: MediaEditor = (id, prepare) => {
  const cm = editor.value
  if (!cm || tabId.value !== id || currentTab.value?.readOnly) throw new Error(t('batchMedia.changed'))
  const edits = prepare(cm.getValue())
  cm.operation(() => {
    for (const edit of edits.reverse()) {
      cm.replaceRange(edit.text, cm.posFromIndex(edit.start), cm.posFromIndex(edit.end), 'embed-document-images')
    }
  })
  saveContent(cm)
}

defineExpose({ applyMediaEdits })

const showContextMenu = (event: MouseEvent): void => {
  const cm = editor.value
  const tab = currentTab.value
  if (!cm || !tab || !isDocumentBackground(event)) return
  event.preventDefault()
  event.stopPropagation()
  const hasSelection = cm.somethingSelected()
  const copySelection = (action: 'copy' | 'cut'): void => {
    if (currentTab.value?.id !== tab.id) return
    cm.focus()
    document.execCommand(action)
  }
  popupContextMenu([
    { id: 'cutMenuItem', label: t('contextMenu.cut'), enabled: hasSelection, click: () => copySelection('cut') },
    { id: 'copyMenuItem', label: t('contextMenu.copy'), enabled: hasSelection, click: () => copySelection('copy') },
    {
      id: 'pasteMenuItem',
      label: t('contextMenu.paste'),
      click: async() => {
        const text = await window.electron.clipboard.readText()
        if (editor.value !== cm || tabId.value !== tab.id || viewDestroyed.value) return
        if (preferencesStore.imageInsertAction === 'embed' && /!\[|<img\b/i.test(text)) {
          await pasteImageDocument(text)
          return
        }
        const video = await readClipboardImage('video').catch(() => undefined)
        if (editor.value !== cm || tabId.value !== tab.id || viewDestroyed.value) return
        if (video) {
          await insertVideo(video)
          return
        }
        if (preferencesStore.imageInsertAction === 'embed') {
          const image = await readClipboardImage().catch(() => undefined)
          if (editor.value !== cm || tabId.value !== tab.id || viewDestroyed.value) return
          if (image) {
            await insertEmbeddedImage(image)
            return
          }
        }
        if (text && editor.value === cm && tabId.value === tab.id && !viewDestroyed.value) {
          cm.replaceSelection(text, 'end', 'paste')
          cm.focus()
        }
      }
    },
    { type: 'separator' },
    ...getDocumentLocationMenuItems(tab),
    { type: 'separator' },
    props.imageMenuItem
  ], { x: event.clientX, y: event.clientY })
}

const isValidMuyaIndexCursor = (cursor: unknown): cursor is MuyaIndexCursorLike => {
  const c = cursor as MuyaIndexCursorLike | null | undefined
  return !!(c && c.anchor && c.focus)
}

watch(
  () => props.textDirection,
  (value, oldValue) => {
    if (value !== oldValue && editor.value) {
      setTextDirection(editor.value, value)
    }
  }
)

watch(sourceCodeLineNumbers, (value) => {
  editor.value?.setOption('lineNumbers', value)
})

// A fresh instance reads these at mount; the watch is for a preference changed
// while the source view is already open (#5446).
const markdownMathMode = () => ({
  name: 'markdown-math',
  texMathDollars: texMathDollars.value,
  texMathGfm: texMathGfm.value,
  texMathSingleBackslash: texMathSingleBackslash.value,
  texMathDoubleBackslash: texMathDoubleBackslash.value
})

watch([texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash], () => {
  editor.value?.setOption('mode', markdownMathMode())
})

const getMarkdownAndCursor = (cm: CodeMirror.Editor) => {
  let focus = cm.getCursor('head')
  let anchor = cm.getCursor('anchor')

  const markdown: string = cm.getValue()
  const convertToMuyaCursor = (cursor: CodeMirror.Position) => {
    const line = cm.getLine(cursor.line)
    const preLine = cm.getLine(cursor.line - 1)
    const nextLine = cm.getLine(cursor.line + 1)
    return adjustCursor(
      cursor,
      preLine,
      line,
      nextLine,
      (lineNumber) => {
        return cm.getLine(lineNumber)
      },
      cm.lineCount()
    )
  }

  anchor = convertToMuyaCursor(anchor)
  focus = convertToMuyaCursor(focus)

  // Normalize cursor that `anchor` is always before `focus` because
  // this is the expected behavior in Muya.
  if (anchor && focus && anchor.line > focus.line) {
    const tmpCursor = focus
    focus = anchor
    anchor = tmpCursor
  }
  return { cursor: { focus, anchor }, markdown }
}

const prepareTabSwitch = () => {
  if (tabId.value && editor.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    editorStore.LISTEN_FOR_CONTENT_CHANGE({
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor
    })
    captureSourceHistory(
      tabId.value,
      editor.value,
      editorStore.tabs.find((tab) => tab.id === tabId.value)?.markdown
    )
    tabId.value = null
  }
}

interface FileChangePayloadLike {
  reason?: string
  id: string
  markdown?: string
  muyaIndexCursor?: unknown
}

const handleFileChange = (payload: unknown) => {
  const { id, markdown: newMarkdown, muyaIndexCursor, reason } = payload as FileChangePayloadLike
  if (reason === 'source-handoff') return
  if (!editor.value) return

  // On same-tab reload (external file change), preserve scroll across
  // setValue. Snapshot every plausible scroll element (the outer
  // .source-code div, CodeMirror's own scroller, and the nearest scrollable
  // ancestor) and restore each, since which one is actually active depends
  // on CodeMirror's height:auto + outer overflow:auto interplay. Re-apply
  // on nextTick and the next animation frame to outlast layout side-effects
  // from sibling handlers: muya editor.vue also listens for file-changed.
  // A cross-tab switch must instead commit the outgoing tab's state; the
  // fresh markdown from disk would otherwise overwrite uncommitted edits.
  const isSameTabReload = tabId.value && tabId.value === id
  const scrollTargets: Array<{ el: HTMLElement; top: number }> = []
  if (isSameTabReload) {
    const seen = new Set<HTMLElement>()
    const consider = (el: HTMLElement | null | undefined) => {
      if (el && !seen.has(el)) {
        seen.add(el)
        scrollTargets.push({ el, top: el.scrollTop })
      }
    }
    consider(sourceCodeContainer.value)
    consider(editor.value.getScrollerElement?.() as HTMLElement | null | undefined)
    let node: HTMLElement | null = sourceCodeContainer.value?.parentElement ?? null
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        consider(node)
        break
      }
      node = node.parentElement
    }
  } else {
    prepareTabSwitch()
    tabId.value = id
  }

  if (typeof newMarkdown === 'string' && editor.value.getValue() !== newMarkdown) {
    editor.value.setValue(newMarkdown)
  }
  if (!isSameTabReload) restoreSourceHistory(id, editor.value)

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor

    editor.value.setSelection(anchor, focus, { scroll: true })
  } else if (scrollTargets.length) {
    const restoreScroll = () => {
      for (const { el, top } of scrollTargets) el.scrollTop = top
    }
    restoreScroll()
    nextTick(restoreScroll)
    requestAnimationFrame(restoreScroll)
  } else {
    setCursorAtFirstLine(editor.value)
  }
}

const handleSelectAll = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.execCommand('selectAll')
  } else {
    const activeElement = document.activeElement as HTMLElement | null
    const nodeName = activeElement?.nodeName
    if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
      const selectable = activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (selectable && typeof selectable.select === 'function') {
        selectable.select()
      }
    }
  }
}

const handleUndo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('undo')
  }
}

const handleRedo = () => {
  if (!sourceCode.value) {
    return
  }

  if (editor.value) {
    editor.value.execCommand('redo')
  }
}

interface ImageActionPayload {
  id: string
  result: string
  alt: string
}

const handleImageAction = (payload: unknown) => {
  const cm = editor.value
  if (!cm) return

  const { id, result, alt } = payload as ImageActionPayload
  const value: string = cm.getValue()
  const focus = cm.getCursor('focus')
  const anchor = cm.getCursor('anchor')
  const lines: string[] = value.split('\n')
  const index = lines.findIndex((line: string) => line.indexOf(id) > 0)

  if (index > -1) {
    const oldLine = lines[index]
    lines[index] = oldLine.replace(new RegExp(`!\\[${id}\\]\\(.*\\)`), `![${alt}](${result})`)
    const newValue = lines.join('\n')
    cm.setValue(newValue)
    const match = /(!\[.*\]\(.*\))/.exec(oldLine)
    if (!match) {
      return
    }
    const range = {
      start: match.index,
      end: match.index + match[1].length
    }
    const delta = alt.length + result.length + 5 - match[1].length

    const adjustPointer = (pointer: CodeMirror.Position) => {
      if (!pointer) {
        return
      }
      if (pointer.line !== index) {
        return
      }
      if (pointer.ch <= range.start) {
        // do nothing.
      } else if (pointer.ch > range.start && pointer.ch < range.end) {
        pointer.ch = range.start + alt.length + result.length + 5
      } else {
        pointer.ch += delta
      }
    }

    adjustPointer(focus)
    adjustPointer(anchor)
    if (focus && anchor) {
      cm.setSelection(anchor, focus, { scroll: true })
    } else {
      setCursorAtFirstLine(cm)
    }
  }
}

// `cursorActivity` fires per drag step, so key the dedup on the ranges rather
// than on `getSelection()`, which copies the whole selection.
let lastSelectionKey = ''

const selectionKey = (cm: CodeMirror.Editor): string =>
  cm
    .listSelections()
    .map(({ anchor, head }) => `${anchor.line}:${anchor.ch}-${head.line}:${head.ch}`)
    .join(',')

const updateSelectionWordCount = (cm: CodeMirror.Editor) => {
  const key = selectionKey(cm)
  if (key === lastSelectionKey && editorStore.selectionWordCount != null) return
  lastSelectionKey = key

  const selectedText = cm.getSelection()
  const hasSelection = selectedText.trim().length > 0
  if (!hasSelection && editorStore.selectionWordCount == null) return

  editorStore.SET_SELECTION_WORD_COUNT(hasSelection && tabId.value ? documentVideos(tabId.value).wordCount(selectedText) : null)
}

const saveContent = (cm: CodeMirror.Editor) => {
  const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(cm)
  if (!viewDestroyed.value) {
    if (tabId.value) {
      editorStore.LISTEN_FOR_CONTENT_CHANGE({
        id: tabId.value,
        markdown: newMarkdown,
        wordCount: documentVideos(tabId.value).wordCount(newMarkdown),
        muyaIndexCursor: cursor
      })
    } else {
      // This may occur during tab switching but should not occur otherwise.
      console.warn('LISTEN_FOR_CONTENT_CHANGE: Cannot commit changes because not tab id was set!')
    }
  }
}

let headingMarkdown: string | undefined
let outline: ReturnType<typeof getMarkdownOutline>

function refreshOutline(cm: CodeMirror.Editor) {
  const markdown = cm.getValue()
  if (markdown !== headingMarkdown || editorStore.listToc[0]?.slug !== outline?.headings[0]?.slug) {
    headingMarkdown = markdown
    outline = getMarkdownOutline(markdown, preferencesStore)
    editorStore.REFRESH_TOC(outline.headings)
  }
}

function beginOutlineMove(begin: unknown) {
  const cm = editor.value
  const id = tabId.value
  if (!cm || !id || currentTab.value?.readOnly || !sourceCode.value || typeof begin !== 'function') return
  refreshOutline(cm)
  const markdown = cm.getValue()
  const send = begin as BeginOutlineMove
  send({ outline, apply(cuts) {
    if (tabId.value !== id || currentTab.value?.id !== id || currentTab.value.readOnly ||
        viewDestroyed.value || !sourceCode.value || cm.getValue() !== markdown) return
    const edit = sectionEdit(markdown, cuts)
    cm.replaceRange(edit.text, cm.posFromIndex(edit.from), cm.posFromIndex(edit.to), 'move-section')
  } })
}

function updateHeadingLink(cm: CodeMirror.Editor) {
  const id = tabId.value
  const pos = cm.getCursor()
  const text = cm.getLine(pos.line)
  const link = !currentTab.value?.readOnly && cm.hasFocus() && !cm.somethingSelected()
    ? headingLinkAt(text, pos.ch) : undefined
  if (!link || cm.getModeAt(pos).name !== 'markdown' || /(?:comment|math|code-block)/.test(cm.getTokenTypeAt(pos) ?? '')) {
    emit('headingLink', null)
    return
  }
  emit('headingLink', { file: link.file, query: link.query, rect: cm.cursorCoords(pos, 'window'),
    apply(href, title) {
      const live = cm.getCursor()
      if (viewDestroyed.value || currentTab.value?.id !== id || currentTab.value?.readOnly ||
          !sourceCode.value || live.line !== pos.line || live.ch !== pos.ch ||
          cm.somethingSelected() || cm.getLine(pos.line) !== text) return
      const edit = link.complete(href, title)
      cm.operation(() => {
        cm.replaceRange(edit.text, { line: pos.line, ch: edit.from }, { line: pos.line, ch: edit.to }, 'heading-link')
        cm.setCursor(pos.line, edit.from + edit.text.length)
      })
    }
  })
}

const setActiveHeadingAtLine = (line: number): void => {
  if (!editor.value) return
  refreshOutline(editor.value)
  const lineEnd = editor.value.indexFromPos({ line, ch: Infinity })
  let slug: string | null = null
  for (let index = 0; index < editorStore.listToc.length; index++) {
    if (outline.headings[index].offset > lineEnd) break
    slug = editorStore.listToc[index].slug ?? null
  }
  editorStore.SET_ACTIVE_HEADING(slug)
}

const updateActiveHeadingFromScroll = (): void => {
  const container = sourceCodeContainer.value
  if (!container || !editor.value) return
  const top = container.getBoundingClientRect().top + 80
  const line = editor.value.lineAtHeight(top, 'window')
  setActiveHeadingAtLine(line)
}

const handleScroll = (): void => {
  updateActiveHeadingFromScroll()
  documentViewChanged()
}

const listenChange = (cm: CodeMirror.Editor) => {
  cm.on('cursorActivity', (instance: CodeMirror.Editor) => {
    saveContent(instance)
    updateSelectionWordCount(instance)
    setActiveHeadingAtLine(instance.getCursor().line)
    updateHeadingLink(instance)
  })
}

// #3580: in Source Code mode the WYSIWYG container is hidden, so the
// `scroll-to-header` bus event (emitted when a TOC entry is clicked) must scroll
// CodeMirror instead. Resolve the TOC entry to its heading line in the source.
const handleScrollToHeader = (slug: unknown) => {
  if (!editor.value) return
  const index = editorStore.listToc.findIndex((item) => item.slug === slug)
  if (index < 0) return
  const heading = outline?.headings[index]
  if (!heading) return
  const line = editor.value.posFromIndex(heading.offset).line
  // `.source-code` is the scroll container (CodeMirror renders full-height with
  // viewportMargin: Infinity, so its own scroller never scrolls).
  scrollSourceEditorToLine(editor.value, line, sourceCodeContainer.value)
}

onMounted(() => {
  if (!currentTab.value) return
  const { id } = currentTab.value
  // Reset WYSIWYG scroll, block and cursor state; source mode uses different coordinates.
  currentTab.value.scrollTop = 0
  currentTab.value.blocks = undefined
  currentTab.value.cursor = undefined

  const { markdown, muyaIndexCursor, textDirection } = props
  const container = sourceCodeContainer.value
  if (!container) return
  const codeMirrorConfig: Record<string, unknown> = {
    value: '',
    lineNumbers: sourceCodeLineNumbers.value,
    autofocus: true,
    lineWrapping: true,
    styleActiveLine: true,
    extraKeys: getSourceExtraKeys(isWindows),
    direction: textDirection,
    viewportMargin: Infinity
  }

  const base = themeBaseId(theme.value)
  if (railscastsThemes.includes(base)) {
    codeMirrorConfig.theme = 'railscasts'
  } else if (oneDarkThemes.includes(base)) {
    codeMirrorConfig.theme = 'one-dark'
  }

  bus.on('file-changed', handleFileChange)
  bus.on('selectAll', handleSelectAll)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('format', handleVideoFormat)
  bus.on('image-action', handleImageAction)
  bus.on('scroll-to-header', handleScrollToHeader)
  bus.on('begin-outline-move', beginOutlineMove)

  // CodeMirror's line tree relies on object identity and must not be proxied by Vue.
  const codeMirrorInstance = markRaw(codeMirror(container, codeMirrorConfig))

  releaseEmbeddedImages = installEmbeddedImages(codeMirrorInstance, (image, event) => emit('editEmbeddedImage', image, event),
    text => tabId.value ? documentVideos(tabId.value).compact(text) : text)
  codeMirrorInstance.setValue(markdown ?? '')
  codeMirrorInstance.setOption('mode', markdownMathMode())

  codeMirrorInstance.on('contextmenu', (_cm: CodeMirror.Editor, event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  })

  if (isValidMuyaIndexCursor(muyaIndexCursor)) {
    const { anchor, focus } = muyaIndexCursor
    codeMirrorInstance.setSelection(anchor, focus, { scroll: true })
  } else {
    setCursorAtFirstLine(codeMirrorInstance)
  }

  restoreSourceHistory(id, codeMirrorInstance)
  editor.value = codeMirrorInstance
  tabId.value = id
  updateSelectionWordCount(codeMirrorInstance)
  refreshOutline(codeMirrorInstance)
  codeMirrorInstance.on('changes', (cm: CodeMirror.Editor, changes: CodeMirror.EditorChange[]) => {
    refreshOutline(cm)
    // Undoing image edits away from the caret does not always emit cursorActivity.
    if (changes.some(change => change.origin === 'undo' || change.origin === 'redo' || change.origin === 'embedded-image-size')) saveContent(cm)
  })

  // Pane resizing rewraps lines without triggering CodeMirror's window-resize listener.
  let measuredWidth = 0
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width
    if (width <= 0 || width === measuredWidth) return
    measuredWidth = width
    codeMirrorInstance.refresh()
    updateActiveHeadingFromScroll()
  })
  resizeObserver.observe(codeMirrorInstance.getWrapperElement())

  releaseViewState = registerSourceViewState({
    documentId: () => tabId.value,
    view: { editor: codeMirrorInstance, container }
  })
  codeMirrorInstance.on('cursorActivity', documentViewChanged)
  listenChange(codeMirrorInstance)
  registerSourceView(async () => {
    if (editor.value) saveContent(editor.value)
  })
})

onBeforeUnmount(() => {
  releaseEmbeddedImages?.()
  releaseViewState?.()
  editor.value?.off('cursorActivity', documentViewChanged)
  resizeObserver?.disconnect()
  registerSourceView(null)
  if (editor.value) {
    saveContent(editor.value)
    captureSourceHistory(
      tabId.value,
      editor.value,
      editorStore.tabs.find((tab) => tab.id === tabId.value)?.markdown
    )
  }
  viewDestroyed.value = true

  bus.off('file-changed', handleFileChange)
  bus.off('selectAll', handleSelectAll)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('format', handleVideoFormat)
  bus.off('image-action', handleImageAction)
  editorStore.SET_SELECTION_WORD_COUNT(null)
  lastSelectionKey = ''
  bus.off('scroll-to-header', handleScrollToHeader)
  bus.off('begin-outline-move', beginOutlineMove)

  if (editor.value) {
    const { cursor, markdown: newMarkdown } = getMarkdownAndCursor(editor.value)
    bus.emit('file-changed', {
      reason: 'source-handoff',
      id: tabId.value,
      markdown: newMarkdown,
      muyaIndexCursor: cursor,
      renderCursor: true
    })
  }
})
</script>

<style>
.source-code {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
}
.source-code .CodeMirror {
  height: auto;
  margin: 50px auto;
  max-width: var(--editorAreaWidth);
  background: transparent;
}
.source-code .CodeMirror-gutters {
  border-right: none;
  background-color: transparent;
}
.source-code .CodeMirror-activeline-background,
.source-code .CodeMirror-activeline-gutter {
  background: var(--floatHoverColor);
}
/* Fade the delimiters against the formula. Dimming the inherited colour rather
   than naming one is what carries across every theme; 0.65 is the lowest value
   still clearing 3:1 in all of them, with one-dark at 3.67 setting the floor. */
.source-code .CodeMirror .cm-formatting-math {
  opacity: 0.65;
}
</style>
