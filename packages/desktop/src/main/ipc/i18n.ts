import { app, ipcMain } from 'electron'
import { clearCache, loadTranslations } from 'common/i18n'

export const registerI18nHandlers = (): void => {
  ipcMain.handle('mt::i18n::load', (_e, language: string) => {
    if (!app.isPackaged) clearCache()
    return loadTranslations(language)
  })
}
