import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { ipcMain } from 'electron'
import { isSamePathSync } from 'common/filesystem/paths'
import {
  maxDocumentChatPromptLength,
  type DocumentChat, type DocumentChatEffects, type DocumentChatHistoryEntry, type DocumentChatRequest,
  type DocumentChatTarget, type DocumentChatTurn
} from '@shared/documentChat'
import { themeBases } from '@shared/localTheme'
import { themeCssIssue } from '@shared/themeCss'
import type Accessor from '../app/accessor'
import { AtomicJsonFile } from '../applicationState/atomicJsonFile'
import { UnsupportedStateVersion } from '../applicationState/codec'
import { WindowType } from '../windows/base'
import { requireModelWindow } from './aiModels'
import { captureDocumentChatPreview } from './documentChatCapture'
import { generateDocumentChatReply } from './documentChatModel'
import type { ChatSettings } from './openAi'

interface Archive {
  version: 1
  chats: DocumentChat[]
}

function parseArchive(value: unknown): Archive {
  const archive = value as Partial<Archive> | null
  if (archive?.version !== 1) throw new UnsupportedStateVersion('Unsupported chat history version')
  if (!Array.isArray(archive.chats) || archive.chats.some(chat => !chat ||
    typeof chat.id !== 'string' || typeof chat.title !== 'string' || !Number.isFinite(chat.updatedAt) ||
    !Array.isArray(chat.turns) || chat.turns.some(turn => !turn || typeof turn.id !== 'string' || typeof turn.prompt !== 'string'))) {
    throw new Error('Invalid chat history')
  }
  return { version: 1, chats: archive.chats }
}

export function registerDocumentChat(app: Accessor, savedSettings: (id: string) => Promise<ChatSettings>): void {
  const file = new AtomicJsonFile<Archive>(path.join(app.paths.userDataPath, 'document-chats.json'), parseArchive,
    () => ({ version: 1, chats: [] }))
  const inFlight = new Map<string, { senderId: number; controller: AbortController }>()
  const capturing = new Set<string>()
  let archive: Archive | undefined
  let writes = Promise.resolve()

  async function read(): Promise<Archive> {
    if (archive) return archive
    const result = await file.load()
    if (result.status === 'read-only-defaulted') throw new Error('Chat history is unavailable')
    archive ??= result.value
    return archive
  }

  function update<T extends DocumentChat | null>(id: string, change: (chat?: DocumentChat) => T): Promise<T> {
    const task = writes.then(async() => {
      const { chats } = await read()
      const chat = change(chats.find(item => item.id === id))
      const remaining = chats.filter(item => item.id !== id)
      const next: Archive = { version: 1, chats: chat ? [chat, ...remaining] : remaining }
      await file.write(next)
      archive = next
      return chat
    })
    writes = task.then(() => {}, () => {})
    return task
  }

  function notify(): void {
    for (const { win } of app.windowManager.getWindowsByType(WindowType.EDITOR)) {
      const window = win.browserWindow
      if (window && !window.isDestroyed()) window.webContents.send('mt::document-chat::changed')
    }
  }

  ipcMain.handle('mt::document-chat::list', async event => {
    requireModelWindow(app, event, WindowType.EDITOR)
    const { chats } = await read()
    return chats.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt)
  })
  ipcMain.handle('mt::document-chat::read', async(event, id: string) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    const { chats } = await read()
    const chat = chats.find(item => item.id === id)
    return chat ? { ...chat, inFlight: inFlight.has(id) } : null
  })
  ipcMain.handle('mt::document-chat::history', async(event, target?: Pick<DocumentChatTarget, 'id' | 'pathname'>) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    if (target !== undefined && (typeof target?.id !== 'string' || typeof target.pathname !== 'string')) {
      throw new Error('invalidRequest')
    }
    const { chats } = await read()
    const entries: (DocumentChatHistoryEntry & { sortTime: number })[] = []
    for (const chat of chats) {
      for (const turn of [...chat.turns].reverse()) {
        const proposal = turn.proposal
        const effect = turn.effects?.markdown
        const reverted = effect === null
        if (!proposal || (!effect && !reverted && !proposal.applied)) continue
        const document = effect?.target ?? proposal.target
        if (target && document.id !== target.id && !isSamePathSync(document.pathname, target.pathname)) continue
        entries.push({ chatId: chat.id, turnId: turn.id, target: document, prompt: turn.prompt,
          changes: proposal.changes, reverted, appliedAt: turn.markdownAppliedAt, sortTime: turn.markdownAppliedAt ?? chat.updatedAt })
      }
    }
    return entries.sort((a, b) => b.sortTime - a.sortTime).map(({ sortTime: _sortTime, ...entry }) => entry)
  })
  ipcMain.handle('mt::document-chat::new', async event => {
    requireModelWindow(app, event, WindowType.EDITOR)
    const id = randomUUID()
    await update(id, () => ({ id, title: '', updatedAt: Date.now(), turns: [] }))
    notify()
    return id
  })
  ipcMain.handle('mt::document-chat::send', async(event, request: DocumentChatRequest) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    if (!request || typeof request.chatId !== 'string' || typeof request.profileId !== 'string' ||
      typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > maxDocumentChatPromptLength) {
      throw new Error('invalidRequest')
    }
    const { chatId, document, profileId, theme, previewDocumentId } = request
    if (previewDocumentId !== undefined && (typeof previewDocumentId !== 'string' || previewDocumentId.length > 120)) {
      throw new Error('invalidRequest')
    }
    if (document !== undefined && (!document || typeof document.markdown !== 'string' ||
      typeof document.pathname !== 'string' || typeof document.id !== 'string' || typeof document.filename !== 'string')) {
      throw new Error('invalidRequest')
    }
    if (theme !== undefined && (!theme || typeof theme.sourceId !== 'string' || theme.sourceId.length > 120 ||
      !themeBases.includes(theme.base) || typeof theme.css !== 'string' || !!themeCssIssue(theme.css) ||
      typeof theme.baseCss !== 'string' || theme.baseCss.length > 100_000)) {
      throw new Error('invalidRequest')
    }
    if (inFlight.has(chatId)) throw new Error('chatBusy')
    const prompt = request.prompt.trim()
    const turn: DocumentChatTurn = { id: randomUUID(), prompt, profileId }
    const controller = new AbortController()
    inFlight.set(chatId, { senderId: event.sender.id, controller })
    try {
      const chat = await update(chatId, current => {
        if (!current) throw new Error('invalidRequest')
        return { ...current, profileId, title: current.title || prompt.split(/\r?\n/, 1)[0].slice(0, 80),
          updatedAt: Date.now(), turns: [...current.turns, turn] }
      })
      notify()
      let reply: Awaited<ReturnType<typeof generateDocumentChatReply>>
      try {
        const settings = await savedSettings(profileId)
        const themeSystemPrompt = theme ? app.preferences.getItem<string>('themeSystemPrompt') : undefined
        reply = await generateDocumentChatReply(settings, chat.turns.slice(0, -1), { ...request, prompt },
          controller.signal, themeSystemPrompt)
        controller.signal.throwIfAborted()
      } catch (error) {
        if (controller.signal.aborted) reply = { error: 'cancelled' }
        else reply = { error: error instanceof Error && error.message === 'configureFirst' ? 'configureFirst' : 'requestFailed' }
      }
      const { capturePreview, ...answer } = reply
      const completed: DocumentChatTurn = {
        ...turn, ...answer, ...(capturePreview && previewDocumentId ? { capture: { documentId: previewDocumentId } } : {})
      }
      await update(chatId, current => ({ ...(current ?? chat),
        turns: (current ?? chat).turns.map(item => item.id === turn.id ? completed : item) }))
      return completed
    } finally {
      inFlight.delete(chatId)
      notify()
    }
  })
  ipcMain.handle('mt::document-chat::stop', (event, id: string) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    const request = inFlight.get(id)
    if (request?.senderId === event.sender.id) request.controller.abort()
  })
  ipcMain.handle('mt::document-chat::capture', async(event, id: string, turnId: string) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    const { chats } = await read()
    const capture = chats.find(chat => chat.id === id)?.turns.find(turn => turn.id === turnId)?.capture
    if (!capture || capture === 'failed' || capturing.has(turnId)) return
    capturing.add(turnId)
    try {
      const screenshot = await captureDocumentChatPreview(event.sender, capture.documentId).catch(() => undefined)
      await update(id, chat => {
        if (!chat) throw new Error('invalidRequest')
        const turns = chat.turns.map<DocumentChatTurn>(turn => turn.id === turnId
          ? { ...turn, capture: screenshot ? undefined : 'failed', screenshot }
          : turn)
        return { ...chat, turns }
      })
      notify()
    } finally {
      capturing.delete(turnId)
    }
  })
  ipcMain.handle('mt::document-chat::effects', async(event, id: string, turnId: string, patch: DocumentChatEffects) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    await update(id, chat => {
      if (!chat?.turns.some(turn => turn.id === turnId)) throw new Error('invalidRequest')
      const turns = chat.turns.map(turn => {
        if (turn.id !== turnId) return turn
        const proposal = turn.proposal && patch.markdown !== undefined
          ? { ...turn.proposal, applied: patch.markdown !== null }
          : turn.proposal
        const markdownAppliedAt = patch.markdown ? turn.markdownAppliedAt ?? Date.now() : turn.markdownAppliedAt
        return { ...turn, proposal, markdownAppliedAt, effects: { ...turn.effects, ...patch } }
      })
      return { ...chat, turns }
    })
    notify()
  })
  ipcMain.handle('mt::document-chat::delete', async(event, id: string, turnId?: string) => {
    requireModelWindow(app, event, WindowType.EDITOR)
    await update(id, chat => {
      if (!chat) return null
      if (inFlight.has(id)) throw new Error('chatBusy')
      if (!turnId) return null
      const turns = chat.turns.filter(turn => turn.id !== turnId)
      return { ...chat, title: turns[0]?.prompt.split(/\r?\n/, 1)[0].slice(0, 80) ?? '', turns }
    })
    notify()
  })
}
