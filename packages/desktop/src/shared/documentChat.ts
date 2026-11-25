import type { MarkdownEdit } from './markdownEdits'
import type { LocalTheme } from './localTheme'
import type { UserPreferences } from './types/preferences'

export const maxDocumentChatPromptLength = 16_000

export interface DocumentChatSummary {
  id: string
  title: string
  updatedAt: number
}

export interface DocumentChatTarget {
  id: string
  pathname: string
  filename: string
}

export interface DocumentChatDocument extends DocumentChatTarget {
  markdown: string
}

export interface DocumentChatProposal {
  target: DocumentChatTarget
  baseHash: string
  changes: (MarkdownEdit & { before: string })[]
  applied?: boolean
}

export interface DocumentChatHistoryEntry {
  chatId: string
  turnId: string
  target: DocumentChatTarget
  prompt: string
  changes: DocumentChatProposal['changes']
  reverted: boolean
  appliedAt?: number
}

export interface DocumentChatThemeContext {
  sourceId: string
  base: string
  css: string
  baseCss: string
}

export interface DocumentChatThemeProposal {
  sourceId: string
  beforeCss: string
  css: string
}

type ThemeSelection = Pick<UserPreferences, 'theme' | 'lightModeTheme' | 'darkModeTheme'>

export interface DocumentChatThemeEffect {
  before: LocalTheme | null
  beforeCss: string
  after: LocalTheme
  selectionBefore: ThemeSelection
  selectionAfter: ThemeSelection
}

export interface DocumentChatMarkdownEffect {
  target: DocumentChatTarget
  before: string
  after: string
}

export interface DocumentChatEffects {
  markdown?: DocumentChatMarkdownEffect | null
  theme?: DocumentChatThemeEffect | null
}

export interface DocumentChatTurn {
  id: string
  prompt: string
  markdownAppliedAt?: number
  profileId?: string
  reply?: string
  proposal?: DocumentChatProposal
  themeProposal?: DocumentChatThemeProposal
  effects?: DocumentChatEffects
  capture?: { documentId: string } | 'failed'
  screenshot?: string
  // Persisted conversations may contain errors from earlier local size checks.
  error?: 'requestFailed' | 'contextTooSmall' | 'documentTooLarge' | 'configureFirst' | 'invalidEdits' | 'invalidThemeEdits' | 'cancelled'
}

export interface DocumentChat extends DocumentChatSummary {
  profileId?: string
  turns: DocumentChatTurn[]
}

export interface DocumentChatRequest {
  chatId: string
  profileId: string
  prompt: string
  document?: DocumentChatDocument
  previewDocumentId?: string
  theme?: DocumentChatThemeContext
}
