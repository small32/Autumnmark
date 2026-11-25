import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The executable name appears in four places that must agree, otherwise a
// release builds fine but fails verification or cannot restart after a swap.
const desktopRoot = path.resolve(__dirname, '../../..')
const read = (relative: string): string => fs.readFileSync(path.join(desktopRoot, relative), 'utf8')

describe('packaging names', () => {
  it('builds the Windows executable name that the release workflow verifies', () => {
    const builder = read('electron-builder.yml')
    const workflow = read('../../.github/workflows/release.yml')
    const match = /executableName: '([^']+)'/.exec(builder)
    expect(match?.[1]).toBe('AutumnMark+')
    expect(workflow).toContain('AutumnMark+.exe')
  })

  it('ships an updater script that can restart a renamed executable', () => {
    // Replacing the folder removes the recorded launch path whenever the
    // executable was renamed, so the script must fall back to what it finds.
    const script = read('build/update/apply-update.ps1')
    expect(script).toContain('Resolve-LaunchPath')
    expect(script).toContain('autumnmark-editor.exe')
  })

  it('keeps the product name and profile directory unchanged by the rename', () => {
    const brand = read('src/shared/brand.ts')
    expect(brand).toContain("APP_NAME = 'AutumnMark+'")
    // The profile directory is deliberately stable: renaming it would orphan
    // settings and recent files of existing installations.
    expect(brand).toContain("APP_PROFILE_NAME = 'autumnmark'")
  })
})
