export interface MarkdownEdit {
  start: number
  end: number
  text: string
}

export type EditMarkdown = (id: string, prepare: (markdown: string) => MarkdownEdit[]) => void

export function applyMarkdownEdits(markdown: string, edits: readonly MarkdownEdit[]): string {
  const parts: string[] = []
  let offset = 0
  for (const { start, end, text } of edits) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < offset || end < start || end > markdown.length) {
      throw new Error('Invalid Markdown edit range')
    }
    parts.push(markdown.slice(offset, start), text)
    offset = end
  }
  parts.push(markdown.slice(offset))
  return parts.join('')
}
