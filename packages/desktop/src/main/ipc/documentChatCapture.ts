import type { Rectangle, WebContents } from 'electron'
import { isDeepStrictEqual } from 'node:util'

async function editorBounds(contents: WebContents, documentId: string): Promise<Rectangle | null> {
  const bounds = await contents.executeJavaScript(`(() => {
    const body = document.querySelector('.editor-with-tabs .document-body')
    if (!body || body.dataset.documentId !== ${JSON.stringify(documentId)}) return null
    const rect = body.getBoundingClientRect()
    const clip = body.parentElement.getBoundingClientRect()
    const left = Math.max(0, rect.left, clip.left)
    const top = Math.max(0, rect.top, clip.top)
    const right = Math.min(innerWidth, rect.right, clip.right)
    const bottom = Math.min(innerHeight, rect.bottom, clip.bottom)
    if (right - left < 2 || bottom - top < 2) return null
    const points = [
      [left + 1, top + 1], [right - 1, top + 1], [left + 1, bottom - 1],
      [right - 1, bottom - 1], [(left + right) / 2, (top + bottom) / 2]
    ]
    if (!points.every(([x, y]) => body.contains(document.elementFromPoint(x, y)))) return null
    return { left, top, right, bottom }
  })()`)
  if (!bounds) return null
  const zoom = contents.getZoomFactor()
  const x = Math.ceil(bounds.left * zoom)
  const y = Math.ceil(bounds.top * zoom)
  const width = Math.floor(bounds.right * zoom) - x
  const height = Math.floor(bounds.bottom * zoom) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

export async function captureDocumentChatPreview(contents: WebContents, documentId: string): Promise<string | undefined> {
  await contents.executeJavaScript(`Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    new Promise(resolve => setTimeout(resolve, 500))
  ])`)
  const rect = await editorBounds(contents, documentId)
  if (!rect) return
  let image = await contents.capturePage(rect)
  const current = await editorBounds(contents, documentId)
  if (image.isEmpty() || !isDeepStrictEqual(rect, current)) return
  const { width, height } = image.getSize()
  if (Math.max(width, height) > 1600) image = image.resize(width >= height ? { width: 1600 } : { height: 1600 })
  return 'data:image/jpeg;base64,' + image.toJPEG(85).toString('base64')
}
