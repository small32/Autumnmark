import { shallowReactive, shallowRef } from 'vue'

export interface DrawingEditor {
  title: string
  source: string
  pathname?: string
  noteId?: string
  embedded?: boolean
  embeddedIndex?: number
  readOnly: boolean
  draft: boolean
  nameOnInsert?: boolean
  filename?: string
  dirtyDraft?: boolean
  commit: (content: string, filename?: string) => Promise<boolean>
  save?: () => Promise<boolean>
  beforeClose?: (transactionId?: string) => Promise<boolean>
}

export const drawingEditorTabs = shallowReactive(new Map<string, DrawingEditor>())
export const drawingDialog = shallowRef<DrawingEditor | null>(null)
