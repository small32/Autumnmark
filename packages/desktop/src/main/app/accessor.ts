import log from 'electron-log'
import WindowManager from '../app/windowManager'
import Preference from '../preferences'
import DataCenter from '../dataCenter'
import Keybindings from '../keyboard/shortcutHandler'
import AppMenu from '../menu'
import { loadMenuCommands } from '../menu/actions'
import { CommandManager, loadDefaultCommands } from '../commands'
import type { AppEnvironment } from './env'
import type AppPaths from './paths'
import type EditorWindow from '../windows/editor'
import { SessionHost } from '../applicationState/sessionHost'
import { t } from '../i18n'

class Accessor {
  public env: AppEnvironment
  public paths: AppPaths
  public preferences: Preference
  public dataCenter: DataCenter
  public commandManager: CommandManager
  public keybindings: Keybindings
  public menu: AppMenu
  public windowManager: WindowManager
  public sessionHost: SessionHost

  constructor(appEnvironment: AppEnvironment) {
    const userDataPath = appEnvironment.paths.userDataPath

    this.env = appEnvironment
    this.paths = appEnvironment.paths

    this.preferences = new Preference(this.paths)
    this.dataCenter = new DataCenter(this.paths)

    this.commandManager = CommandManager
    this._loadCommands()

    this.keybindings = new Keybindings(this.commandManager, appEnvironment)
    this.menu = new AppMenu(this.preferences, this.keybindings, userDataPath)
    this.windowManager = new WindowManager(this.menu, this.preferences)
    this.sessionHost = new SessionHost(this)
    this.windowManager.on('fileChanged', (windowId, change) => {
      const editor = this.windowManager.get(windowId) as EditorWindow | undefined
      const host = this.sessionHost
      if (host && editor?.sessionStateId) {
        void host.observeFile(editor.sessionStateId, change)
          .catch(error => host.report(error, editor.sessionStateId ?? undefined))
      }
    })
  }

  private _loadCommands(): void {
    const { commandManager } = this
    loadDefaultCommands(commandManager)
    loadMenuCommands(commandManager, sender => {
      const editor = this.windowManager.getEditorForWebContents(sender)
      const host = this.sessionHost
      const id = editor?.sessionStateId
      if (!host || !id) return undefined
      const reportMoveError = (error: unknown): void => {
        log.warn('Document move failed', error)
        if (!sender.isDestroyed()) {
          sender.send('mt::show-notification', {
            title: t('sideBar.move.title'),
            type: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
      return {
        rename: (documentId, pathname) => host.renameDocument(id, documentId, pathname).catch(reportMoveError),
        move: documentId => host.moveDocument(id, documentId).catch(reportMoveError)
      }
    })

    if (this.env.isDevMode) {
      commandManager.__verifyDefaultCommands()
    }
  }
}

export default Accessor
