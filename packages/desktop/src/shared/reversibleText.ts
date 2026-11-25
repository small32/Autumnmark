import diff from 'fast-diff'
import { applyMarkdownEdits, type MarkdownEdit } from './markdownEdits'

export function textChanges(before: string, after: string): MarkdownEdit[] {
  const edits: MarkdownEdit[] = []
  let offset = 0
  let edit: MarkdownEdit | undefined
  for (const [operation, text] of diff(before, after)) {
    if (operation === diff.EQUAL) {
      if (edit) edits.push(edit)
      edit = undefined
      offset += text.length
    } else {
      edit ??= { start: offset, end: offset, text: '' }
      if (operation === diff.INSERT) edit.text += text
      else {
        offset += text.length
        edit.end = offset
      }
    }
  }
  if (edit) edits.push(edit)
  return edits
}

export function reverseTextChange(current: string, before: string, after: string): string | null {
  if (current === before || current === after) return before
  // Both sets of offsets refer to the recorded result, so later edits only shift disjoint inverse ranges.
  const intervening = textChanges(after, current)
  const inverse = textChanges(after, before)
  const edits: MarkdownEdit[] = []
  for (const edit of inverse) {
    let shift = 0
    for (const change of intervening) {
      if (edit.start === edit.end && change.start === edit.start) return null
      if (change.end <= edit.start) {
        shift += change.text.length - (change.end - change.start)
      } else if (change.start < edit.end) {
        return null
      } else break
    }
    edits.push({ ...edit, start: edit.start + shift, end: edit.end + shift })
  }
  return applyMarkdownEdits(current, edits)
}
