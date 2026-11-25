import { isInlineDrawingSource } from '@muyajs/core'
import { documentMediaSource } from '@/services/pastedImages'
import { isDrawingPath } from '@shared/drawing'

export { isDrawingPath } from '@shared/drawing'
export const isDrawingReference = (src: string) => isInlineDrawingSource(src) || isDrawingPath(documentMediaSource(src))

export function resolveDrawingPath(src: string, documentPath?: string | null): string | undefined {
  if (!documentPath || /^(?:[a-z][\w+.-]*:|[/\\])/i.test(src)) return
  const relative = documentMediaSource(src)
  if (!isDrawingPath(relative) || /^(?:[a-z][\w+.-]*:|[/\\])/i.test(relative) || relative.includes('\0')) return
  return window.path.resolve(window.path.dirname(documentPath), relative)
}

export function relativeDrawingResource(owner: string, target: string): string {
  const relative = window.path.relative(window.path.dirname(owner), target)
  if (!relative || window.path.isAbsolute(relative)) throw new Error('The files must be on the same volume')
  return relative.replace(/\\/g, '/')
}

export function drawingDestination(documentPath: string, drawingPath: string): string {
  return relativeDrawingResource(documentPath, drawingPath).split('/').map(segment =>
    encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29')
  ).join('/')
}
