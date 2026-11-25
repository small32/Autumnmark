import './drawingFonts'
import { exportToBlob, loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFileData, BinaryFiles, DataURL } from '@excalidraw/excalidraw/types'
import { getMarkdownOutline, renderToStaticHTML } from '@muyajs/core'
import { t } from '@/i18n'
import { usePreferencesStore } from '@/store/preferences'
import { relativeDrawingResource, resolveDrawingPath } from '@/util/drawingPaths'
import { toDataUrl } from '@/util/embedImage'

export interface DrawingScene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

interface DocumentReference {
  path: string
  heading?: string
}

export async function readDrawing(path: string) {
  const source = await window.fileUtils.readFile(path, 'utf8')
  if (typeof source !== 'string') throw new Error('Expected a drawing file')
  return { source, scene: await parseDrawing(source) }
}

export async function parseDrawing(source: string): Promise<DrawingScene> {
  const { elements, appState, files } = await loadFromBlob(new Blob([source]), null, null)
  return { elements, appState, files }
}

export function serializeDrawing(scene: DrawingScene): string {
  return serializeAsJSON(scene.elements, scene.appState, scene.files, 'local')
}

export async function readCardDocument(path: string) {
  const { autoGuessEncoding } = usePreferencesStore()
  const { markdown } = await window.electron.ipcRenderer.invoke('mt::media::read-document', path, autoGuessEncoding)
  const text = markdown.replace(/\r\n?/g, '\n')
  return { text, headings: getMarkdownOutline(text).headings }
}

type CardDocument = Awaited<ReturnType<typeof readCardDocument>>

function cardMarkup(document: CardDocument, heading?: string): string {
  if (!heading) return document.text
  const start = document.headings.findIndex(item => item.githubSlug === heading)
  if (start < 0) throw new Error('The linked section no longer exists')
  const current = document.headings[start]
  const next = document.headings.slice(start + 1).find(item => item.lvl <= current.lvl)
  return document.text.slice(current.offset, next?.offset)
}

function cardText(markdown: string, pathname: string) {
  const template = document.createElement('template')
  template.innerHTML = renderToStaticHTML(markdown, { frontMatter: true })
  for (const code of template.content.querySelectorAll('pre > code.language-excalidraw')) {
    const label = document.createElement('p')
    label.textContent = `↗ ${t('drawing.embedded')}`
    code.parentElement?.replaceWith(label)
  }
  for (const image of template.content.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? ''
    const isDrawing = resolveDrawingPath(source, pathname) || /\.excalidraw(?:[?#]|$)/i.test(source)
    const label = image.alt || window.path.basename(source)
    image.replaceWith(document.createTextNode(isDrawing ? `↗ ${label}` : label))
  }
  return [...template.content.children].map(node => {
    if (node.matches('ul, ol')) {
      return [...node.children].map((item, index) => ({
        text: `${node.matches('ol') ? `${index + 1}.` : '•'} ${item.textContent ?? ''}`,
        size: 15,
        bold: false
      }))
    }
    return [{
      text: node.textContent ?? '',
      size: node.matches('h1, h2') ? 20 : 15,
      bold: /^H[1-6]$/.test(node.tagName)
    }]
  }).flat()
}

function drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, step: number) {
  let line = ''
  for (const character of text) {
    if (line && (character === '\n' || ctx.measureText(line + character).width > width)) {
      ctx.fillText(line.trimEnd(), x, y)
      y += step
      if (y >= 368) return y
      line = ''
    }
    if (character !== '\n') line += character
  }
  if (line) ctx.fillText(line.trimEnd(), x, y)
  return y + step
}

export function makeDocumentCard(document: CardDocument, pathname: string, fileId: FileId, heading?: string) {
  const width = 440
  const height = 400
  const canvas = window.document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not render the document card')
  ctx.scale(2, 2)
  ctx.beginPath()
  ctx.roundRect(1, 1, width - 2, height - 2, 12)
  ctx.fillStyle = '#fffefb'
  ctx.fill()
  ctx.strokeStyle = '#c9c4b7'
  ctx.stroke()
  ctx.font = '600 16px system-ui'
  ctx.fillStyle = '#605b50'
  ctx.fillText(window.path.basename(pathname), 20, 33, width - 40)
  ctx.fillStyle = '#dedbd2'
  ctx.fillRect(20, 48, width - 40, 1)
  ctx.fillStyle = '#262421'
  let y = 76
  for (const { text, size, bold } of cardText(cardMarkup(document, heading), pathname)) {
    ctx.font = `${bold ? 600 : 400} ${size}px system-ui`
    y = drawLine(ctx, text.trim(), 20, y, width - 40, size + 7) + 4
    if (y >= 368) {
      ctx.font = '16px system-ui'
      ctx.fillText('…', 20, 382)
      break
    }
  }
  const file: BinaryFileData = {
    id: fileId,
    dataURL: canvas.toDataURL('image/png') as DataURL,
    mimeType: 'image/png',
    created: Date.now()
  }
  return { file, width, height }
}

export function documentReference(element: ExcalidrawElement): DocumentReference | undefined {
  if (element.type !== 'image') return
  const reference: unknown = element.customData?.autumnmarkDocument
  if (!reference || typeof reference !== 'object' || !('path' in reference) || typeof reference.path !== 'string') return
  const { path } = reference
  const heading = 'heading' in reference && typeof reference.heading === 'string' ? reference.heading : undefined
  if (!path || /^(?:[a-z][\w+.-]*:|[/\\])/i.test(path) || path.includes('\0') || !window.fileUtils.hasMarkdownExtension(path)) return
  return { path, heading }
}

export function referenceForCard(drawingPath: string, documentPath: string, heading?: string): DocumentReference {
  return { path: relativeDrawingResource(drawingPath, documentPath), heading }
}

export function referencedDocument(drawingPath: string, reference: DocumentReference): string {
  return window.path.resolve(window.path.dirname(drawingPath), reference.path)
}

export async function rebaseDrawingCards(source: string, from: string, to?: string | null): Promise<string> {
  if (!from || from === to) return source
  const scene = await parseDrawing(source)
  const elements = scene.elements.map(element => {
    const reference = documentReference(element)
    if (!reference) return element
    const path = referencedDocument(from, reference)
    const relative = to && window.path.relative(window.path.dirname(to), path)
    const customData: Record<string, unknown> = { ...element.customData }
    if (!relative || window.path.isAbsolute(relative)) {
      delete customData.autumnmarkDocument
      return { ...element, customData, link: null }
    }
    const rebased = { ...reference, path: relative.replace(/\\/g, '/') }
    const link = `${encodeURI(rebased.path)}${rebased.heading ? '#' + encodeURIComponent(rebased.heading) : ''}`
    return { ...element, customData: { ...customData, autumnmarkDocument: rebased }, link }
  })
  return serializeDrawing({ ...scene, elements })
}

export async function refreshDocumentCards(scene: DrawingScene, drawingPath: string): Promise<DrawingScene> {
  const documents = new Map<string, Promise<CardDocument>>()
  const files = { ...scene.files }
  await Promise.all(scene.elements.map(async element => {
    if (element.type !== 'image' || !element.fileId || element.isDeleted) return
    const fileId = element.fileId
    const reference = documentReference(element)
    if (!reference) return
    const path = referencedDocument(drawingPath, reference)
    const document = documents.get(path) ?? readCardDocument(path)
    documents.set(path, document)
    try {
      const { file } = makeDocumentCard(await document, path, fileId, reference.heading)
      if (files[fileId]?.dataURL !== file.dataURL) files[fileId] = file
    } catch {
      // An unavailable source leaves the saved snapshot readable.
    }
  }))
  return { ...scene, files }
}

export async function renderDrawingPreview(path: string): Promise<string> {
  const { scene } = await readDrawing(path)
  const refreshed = await refreshDocumentCards(scene, path)
  return renderDrawingScene(refreshed)
}

export async function renderDrawingScene({ elements, appState, files }: DrawingScene): Promise<string> {
  if (elements.every(element => element.isDeleted)) {
    const blank = document.createElement('canvas')
    blank.width = 200
    blank.height = 120
    const ctx = blank.getContext('2d')
    if (ctx) {
      ctx.fillStyle = appState.viewBackgroundColor ?? '#ffffff'
      ctx.fillRect(0, 0, blank.width, blank.height)
    }
    return blank.toDataURL('image/png')
  }
  return toDataUrl(await exportToBlob({ elements, files, appState: { ...appState, exportBackground: true }, maxWidthOrHeight: 1600 }))
}
