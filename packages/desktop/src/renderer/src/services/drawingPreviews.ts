import { decodeInlineDrawing, findDocumentImages, isInlineDrawingSource } from '@muyajs/core'
import { applyMarkdownEdits } from '@shared/markdownEdits'
import { imageDestinationEdits } from '@/util/documentImages'
import { resolveDrawingPath } from '@/util/drawingPaths'

const pending = new Map<string, Promise<string>>()

function preview(path: string): Promise<string> {
  const loading = pending.get(path)
  if (loading) return loading
  const request = import('./drawingScene').then(module => module.renderDrawingPreview(path)).finally(() => {
    if (pending.get(path) === request) pending.delete(path)
  })
  pending.set(path, request)
  return request
}

export const invalidateDrawingPreviews = () => pending.clear()

export async function renderEmbeddedDrawingPreview(source: string): Promise<string> {
  const { parseDrawing, renderDrawingScene } = await import('./drawingScene')
  return renderDrawingScene(await parseDrawing(source))
}

export function resolveDrawingPreview(src: string, documentPath?: string | null) {
  if (isInlineDrawingSource(src)) {
    return {
      key: src,
      load: async() => {
        const source = decodeInlineDrawing(src)
        if (source === undefined) throw new Error('Invalid inline drawing')
        return renderEmbeddedDrawingPreview(source)
      }
    }
  }
  const path = resolveDrawingPath(src, documentPath)
  if (path) return { key: path, load: () => preview(path) }
}

export async function expandDrawingPreviews(markdown: string, documentPath?: string | null): Promise<string> {
  if (!/excalidraw/i.test(markdown)) return markdown
  const converted = new Map<string, string>()
  const sources = new Set(findDocumentImages(markdown).map(image => image.src))
  await Promise.all([...sources].map(async src => {
    const drawing = resolveDrawingPreview(src, documentPath)
    if (!drawing) return
    try {
      converted.set(src, await drawing.load())
    } catch {
      // Keeping the original reference preserves its alt text if the drawing becomes unavailable.
    }
  }))
  return applyMarkdownEdits(markdown, imageDestinationEdits(markdown, converted))
}
