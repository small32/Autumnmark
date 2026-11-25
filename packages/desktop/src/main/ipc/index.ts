import { app, ipcMain, net } from 'electron'
import { registerBootInfo } from './bootInfo'
import { registerFsHandlers, type FileOperations } from './fs'
import { registerPathHandlers } from './paths'
import { registerRipgrepHandlers } from './ripgrep'
import { registerUploaderHandlers, type UploaderSettings } from './uploader'
import { registerFontsHandlers } from './fonts'
import { registerShellHandlers } from './shell'
import { registerWindowHandlers } from './window'
import { registerCmdHandlers } from './cmd'
import { registerI18nHandlers } from './i18n'
import { registerDialogHandlers } from './dialog'
import { registerDiagramHandlers } from './diagram'
import { registerLinkHtmlHandler } from './linkHtml'
import { registerImageClipboardHandlers } from './clipboardImage'
import { RemoteContentCache } from './remoteContent'
import { registerEmbeddedImageDrag } from './embeddedImageDrag'

export const registerSandboxIpcHandlers = (
  fileOperations?: FileOperations,
  getUploaderSettings: () => UploaderSettings | Promise<UploaderSettings> = () => ({
    currentUploader: 'picgo',
    cliScript: ''
  })
): void => {
  registerBootInfo()
  registerFsHandlers(fileOperations)
  registerPathHandlers()
  registerRipgrepHandlers()
  registerUploaderHandlers(getUploaderSettings)
  registerFontsHandlers()
  registerShellHandlers()
  registerWindowHandlers()
  registerCmdHandlers()
  registerI18nHandlers()
  registerDialogHandlers()
  registerDiagramHandlers()
  registerLinkHtmlHandler()
  registerImageClipboardHandlers()
  registerEmbeddedImageDrag()
  const remoteContent = new RemoteContentCache(net.fetch)
  ipcMain.handle('mt::remote-content::fetch', (_event, kind: unknown, refresh: unknown) =>
    remoteContent.load(kind, refresh === true)
  )
  void app.whenReady().then(() => {
    void remoteContent.load('about')
  })
}
