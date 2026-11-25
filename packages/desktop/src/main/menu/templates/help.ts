import { shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import * as actions from '../actions/help'
import { checkUpdates } from '../actions/marktext'
import { t } from '../../i18n'
import { canCheckForUpdates } from '../../utils/isUpdatable'
import { END_USER_DOCS_URL, GITHUB_REPO_URL } from '@shared/brand'

export default function(): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.help.markdownReference'),
      click() {
        shell.openExternal(`${END_USER_DOCS_URL}/MARKDOWN_SYNTAX.md`)
      }
    },
    {
      label: t('menu.help.changelog'),
      click() {
        shell.openExternal(`${GITHUB_REPO_URL}/releases`)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.followUs'),
      click() {
        shell.openExternal('https://github.com/Autumn-one/notify/blob/main/info.md')
      }
    },
    {
      label: t('menu.help.viewSource'),
      click() {
        shell.openExternal(GITHUB_REPO_URL)
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('menu.help.license'),
      click() {
        shell.openExternal(`${GITHUB_REPO_URL}/blob/develop/LICENSE`)
      }
    }
  ]

  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help.help'),
    role: 'help',
    submenu
  }

  if (canCheckForUpdates()) {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.checkUpdates'),
        click(_menuItem, browserWindow) {
          checkUpdates((browserWindow as BrowserWindow | undefined) ?? null)
        }
      }
    )
  }

  if (process.platform !== 'darwin') {
    submenu.push(
      {
        type: 'separator'
      },
      {
        label: t('menu.help.about'),
        click(_menuItem, browserWindow) {
          actions.showAboutDialog(browserWindow as BrowserWindow | undefined)
        }
      }
    )
  }
  return helpMenu
}
