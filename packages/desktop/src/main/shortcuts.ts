import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import log from 'electron-log'

// The executable was renamed from `autumnmark-editor.exe` to `AutumnMark+.exe`.
// Shortcuts created by the old installer still point at the removed file, so a
// packaged build repoints them at itself once per launch.
const LEGACY_EXECUTABLE_NAMES = ['autumnmark-editor.exe']

const shortcutDirectories = (): string[] => [
  path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  app.getPath('desktop')
]

export const repairShortcuts = (): void => {
  if (process.platform !== 'win32' || !app.isPackaged) return

  const executable = app.getPath('exe')
  for (const directory of shortcutDirectories()) {
    let entries: string[]
    try {
      entries = fs.readdirSync(directory)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.lnk')) continue
      const shortcut = path.join(directory, entry)
      let details: Electron.ShortcutDetails
      try {
        details = shell.readShortcutLink(shortcut)
      } catch {
        continue
      }

      const target = details.target
      if (!target) continue
      const stale = !fs.existsSync(target)
        || LEGACY_EXECUTABLE_NAMES.includes(path.basename(target).toLowerCase())
      if (!stale) continue

      try {
        shell.writeShortcutLink(shortcut, {
          target: executable,
          cwd: path.dirname(executable),
          args: details.args,
          description: details.description || path.basename(executable),
          icon: details.icon || executable,
          iconIndex: details.iconIndex ?? 0,
          appUserModelId: details.appUserModelId
        })
        log.info(`Repaired stale shortcut: ${shortcut}`)
      } catch (error) {
        log.warn(`Could not repair shortcut ${shortcut}:`, error)
      }
    }
  }
}
