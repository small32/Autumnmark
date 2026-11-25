import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import { sync as writeAtomic } from 'write-file-atomic'
import type { AiConnectionDraft, AiModelDraft, AiModelOptions, AiModelProfile } from '@shared/aiModel'
import { aiInputTypes } from '@shared/aiModel'
import type Accessor from '../app/accessor'
import { WindowType, type WindowTypeValue } from '../windows/base'
import { listProviderModels, modelBaseUrl, testModelConnection, type ChatSettings } from './openAi'

type StoredModel = Omit<AiModelProfile, 'hasKey'> & { encryptedKey: string }

const optionsFrom = (draft: AiModelOptions): AiModelOptions => {
  const { model, requestType = 'chat-completions', reasoningEffort, contextSize, outputSize, inputTypes = [] } = draft
  if (!Array.isArray(inputTypes) || !inputTypes.every(type => aiInputTypes.includes(type))) throw new Error('invalidRequest')
  if (requestType !== 'chat-completions' && requestType !== 'responses') throw new Error('invalidRequest')
  if (typeof model !== 'string' || !model.trim() || model.length > 256 || typeof reasoningEffort !== 'string')
    throw new Error('invalidRequest')
  for (const size of [contextSize, outputSize]) {
    if (size !== null && (!Number.isSafeInteger(size) || size <= 0)) throw new Error('invalidSize')
  }
  if (contextSize !== null && outputSize !== null && outputSize > contextSize) throw new Error('invalidSize')
  return { model: model.trim(), requestType, reasoningEffort: reasoningEffort.trim(), contextSize, outputSize, inputTypes: [...new Set(inputTypes)] }
}

export const requireModelWindow = (app: Accessor, event: IpcMainInvokeEvent, ...types: WindowTypeValue[]): void => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const owner = window && app.windowManager.get(window.id)
  if (!owner || event.senderFrame !== event.sender.mainFrame || !types.includes(owner.type)) throw new Error('invalidRequest')
}

export const registerAiModels = (app: Accessor) => {
  const file = path.join(app.paths.userDataPath, 'theme-model.json')
  const read = (): StoredModel[] => {
    if (!existsSync(file)) return []
    const saved = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (Array.isArray(saved)) return saved.map(profile => ({ requestType: 'chat-completions', ...profile }))
    // The original theme assistant stored one completion endpoint and one OS-encrypted key.
    if (typeof saved?.endpoint !== 'string' || typeof saved.model !== 'string' || typeof saved.encryptedKey !== 'string')
      throw new Error('invalidRequest')
    if (!saved.endpoint && !saved.model && !saved.encryptedKey) return []
    return [{ id: 'theme-model', requestType: 'chat-completions', baseUrl: modelBaseUrl(saved.endpoint), model: saved.model, encryptedKey: saved.encryptedKey,
      reasoningEffort: '', contextSize: null, outputSize: null }]
  }
  const lookup = (models: StoredModel[], id: string): StoredModel => {
    const model = models.find(item => item.id === id)
    if (!model) throw new Error('configureFirst')
    return model
  }
  const profiles = (models: StoredModel[]): AiModelProfile[] =>
    models.map(({ encryptedKey, ...profile }) => ({ ...profile, hasKey: !!encryptedKey }))
  const persist = (models: StoredModel[]): AiModelProfile[] => {
    writeAtomic(file, JSON.stringify(models), { mode: 0o600 })
    const list = profiles(models)
    for (const { win } of app.windowManager.getWindowsByType(WindowType.STUDIO)) {
      win.browserWindow?.webContents.send('mt::ai::changed', list)
    }
    return list
  }
  const endpoint = (draft: AiConnectionDraft, models: StoredModel[]) => {
    const baseUrl = modelBaseUrl(draft.baseUrl)
    const existing = draft.id === undefined ? undefined : lookup(models, draft.id)
    if (draft.key !== null && (typeof draft.key !== 'string' || draft.key.length > 8192)) throw new Error('invalidRequest')
    if (draft.key === null && existing?.encryptedKey && baseUrl !== existing.baseUrl) throw new Error('newKeyRequired')
    return { baseUrl, existing }
  }
  const connection = async(draft: AiConnectionDraft, models = read()) => {
    const { baseUrl, existing } = endpoint(draft, models)
    let key = draft.key ?? ''
    if (draft.key === null && existing?.encryptedKey) {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(existing.encryptedKey, 'base64'))
      key = decrypted.result
    }
    return { baseUrl, key }
  }
  const savedSettings = async(id: string): Promise<ChatSettings> => {
    const models = read()
    const profile = lookup(models, id)
    return { ...optionsFrom(profile), ...await connection({ id, baseUrl: profile.baseUrl, key: null }, models) }
  }
  ipcMain.handle('mt::ai::list', event => {
    requireModelWindow(app, event, WindowType.SETTINGS, WindowType.STUDIO)
    return profiles(read())
  })
  ipcMain.handle('mt::ai::save', async(event, draft: AiModelDraft) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    if (draft.displayName !== undefined && typeof draft.displayName !== 'string') throw new Error('invalidRequest')
    const displayName = draft.displayName?.trim() || undefined
    const options = optionsFrom(draft)
    const { baseUrl, existing } = endpoint(draft, read())
    let encryptedKey = draft.key === null ? existing?.encryptedKey ?? '' : ''
    if (draft.key) {
      const available = await safeStorage.isAsyncEncryptionAvailable()
      if (!available) throw new Error('keyStore')
      const encrypted = await safeStorage.encryptStringAsync(draft.key)
      encryptedKey = encrypted.toString('base64')
    }
    const models = read()
    const model = { ...options, id: existing?.id ?? randomUUID(), displayName, baseUrl, encryptedKey }
    if (existing) {
      const latest = lookup(models, existing.id)
      if (JSON.stringify(latest) !== JSON.stringify(existing)) throw new Error('modelChanged')
      models[models.indexOf(latest)] = model
    } else {
      models.push(model)
    }
    return persist(models)
  })
  ipcMain.handle('mt::ai::delete', (event, id: string) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    return persist(read().filter(item => item.id !== id))
  })
  ipcMain.handle('mt::ai::discover', async(event, draft: AiConnectionDraft) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    return listProviderModels(await connection(draft))
  })
  ipcMain.handle('mt::ai::test', async(event, draft: AiModelDraft | string) => {
    requireModelWindow(app, event, WindowType.SETTINGS)
    const settings = typeof draft === 'string' ? await savedSettings(draft) : { ...optionsFrom(draft), ...await connection(draft) }
    await testModelConnection(settings)
  })
  return savedSettings
}
