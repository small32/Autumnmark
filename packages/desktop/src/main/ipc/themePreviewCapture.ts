import type { IpcMainEvent, Rectangle, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { PreparedPreview, PreviewCrop, PreviewTarget, ThemeCaptureEvent } from '@shared/localTheme'

export type CapturePreview = (target: PreviewTarget, css: string) => Promise<{ text: string; image?: string }>

async function previewBounds(contents: WebContents, crop: PreviewCrop): Promise<Rectangle> {
  const bounds = await contents.executeJavaScript(`(() => {
    const frame = document.querySelector('.theme-studio .preview iframe[src="./theme-preview.html"]')
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    const x = rect.left + frame.clientLeft
    const y = rect.top + frame.clientTop
    if (![ [x+1,y+1], [x+frame.clientWidth-1,y+1], [x+1,y+frame.clientHeight-1],
      [x+frame.clientWidth-1,y+frame.clientHeight-1], [x+frame.clientWidth/2,y+frame.clientHeight/2] ]
      .every(([px,py]) => document.elementFromPoint(px,py) === frame)) return null
    return { x, y, width: frame.clientWidth, height: frame.clientHeight }
  })()`)
  if (!bounds || ![crop.x, crop.y, crop.width, crop.height, crop.viewportWidth, crop.viewportHeight].every(Number.isFinite) ||
    Math.abs(bounds.width - crop.viewportWidth) > 1 || Math.abs(bounds.height - crop.viewportHeight) > 1 ||
    crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) throw new Error('previewFailed')
  const zoom = contents.getZoomFactor()
  const x = Math.ceil((bounds.x + crop.x) * zoom)
  const y = Math.ceil((bounds.y + crop.y) * zoom)
  const width = Math.floor((bounds.x + Math.min(bounds.width, crop.x + crop.width)) * zoom) - x
  const height = Math.floor((bounds.y + Math.min(bounds.height, crop.y + crop.height)) * zoom) - y
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) throw new Error('previewFailed')
  return { x, y, width, height }
}

async function captureThemePreview(contents: WebContents, signal: AbortSignal, crop: PreviewCrop): Promise<string> {
  const rect = await previewBounds(contents, crop)
  signal.throwIfAborted()
  let image = await contents.capturePage(rect)
  // Discard a capture if resizing or docking the inspector moved another panel into the crop.
  const current = await previewBounds(contents, crop)
  if (image.isEmpty() || current.x !== rect.x || current.y !== rect.y || current.width !== rect.width || current.height !== rect.height)
    throw new Error('previewFailed')
  const { width, height } = image.getSize()
  if (Math.max(width, height) > 1600) image = image.resize(width >= height ? { width: 1600 } : { height: 1600 })
  return 'data:image/jpeg;base64,' + image.toJPEG(85).toString('base64')
}

export function previewCaptureTool(sender: WebContents, signal: AbortSignal, progress: (event: ThemeCaptureEvent) => void): CapturePreview {
  return async(target: PreviewTarget, css: string) => {
    const token = randomUUID()
    const wait = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    let listener: ((event: IpcMainEvent, id: string, result: PreparedPreview) => void) | undefined
    let abort: (() => void) | undefined
    try {
      wait.throwIfAborted()
      const prepared = await new Promise<PreparedPreview>((resolve, reject) => {
        listener = (event, id, result) => {
          if (event.senderFrame === sender.mainFrame && id === token) resolve(result)
        }
        abort = () => reject(wait.reason)
        sender.ipc.on('mt::theme::preview-painted', listener)
        wait.addEventListener('abort', abort, { once: true })
        progress({ prepareCapture: token, target, css })
      })
      if ('error' in prepared) return { text: prepared.error }
      const image = await captureThemePreview(sender, wait, prepared.crop)
      wait.throwIfAborted()
      const partial = prepared.crop.clipped ? ' Some of the target is clipped by its container.' : ''
      return { image, text: `Screenshot captured. Slice ${target.slice} of ${prepared.crop.slices}.${partial}` }
    } catch {
      signal.throwIfAborted()
      return { text: 'Could not capture the preview. It may be covered, resized, or unavailable.' }
    } finally {
      if (listener) sender.ipc.removeListener('mt::theme::preview-painted', listener)
      if (abort) wait.removeEventListener('abort', abort)
      progress({ releaseCapture: token })
    }
  }
}
