import { encodeInlineDrawing, findEmbeddedDrawings, imageToMarkdown, type IDrawingInsertion } from '@muyajs/core'

const probeSource = encodeInlineDrawing('')
const probeImage = imageToMarkdown({ src: probeSource })

export function drawingInsertionAt(markdown: string, offset: number): IDrawingInsertion | undefined {
  const replace = (markup: string) => markdown.slice(0, offset) + markup + markdown.slice(offset)
  // Parsing a placeholder rules out positions such as code spans and link destinations.
  const destination = offset + probeImage.indexOf(probeSource)
  const embeddedIndex = findEmbeddedDrawings(replace(probeImage)).findIndex(drawing =>
    drawing.kind === 'inline' && drawing.start === destination)
  if (embeddedIndex < 0) return
  return {
    markdown,
    embeddedIndex,
    replace
  }
}
