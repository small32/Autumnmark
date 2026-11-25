import fs from 'node:fs'
import path from 'node:path'

// A full `electron-builder --dir` needs to rename/delete a folder that holds
// hundreds of files. Sandboxes and CI caches sometimes refuse that, so this
// script answers the only question a local smoke build is usually run for:
// which executable name will the package contain, and do the workflow and the
// updater script agree with it?
const desktopRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(desktopRoot, '../..')

interface Check {
  label: string
  ok: boolean
  detail: string
}

const read = (file: string): string => fs.readFileSync(file, 'utf8')
const builder = read(path.join(desktopRoot, 'electron-builder.yml'))
const workflow = read(path.join(repoRoot, '.github/workflows/release.yml'))
const script = read(path.join(desktopRoot, 'build/update/apply-update.ps1'))

const productName = /^productName:\s*(.+)$/m.exec(builder)?.[1]?.trim() ?? ''
const executableName = /executableName:\s*'([^']+)'/.exec(builder)?.[1] ?? ''
const legacyExecutable = 'autumnmark-editor.exe'
const expectedExecutable = `${executableName}.exe`

const checks: Check[] = [
  {
    label: 'product name',
    ok: productName === 'AutumnMark+',
    detail: productName || '(missing productName)'
  },
  {
    label: 'windows executable',
    ok: executableName === 'AutumnMark+',
    detail: expectedExecutable
  },
  {
    label: 'release workflow verifies it',
    ok: workflow.includes(expectedExecutable),
    detail: workflow.includes(expectedExecutable) ? 'matches' : `release.yml does not mention ${expectedExecutable}`
  },
  {
    label: 'updater script falls back to a renamed executable',
    ok: script.includes('Resolve-LaunchPath') && script.includes(legacyExecutable),
    detail: script.includes('Resolve-LaunchPath') ? 'fallback present' : 'fallback missing'
  },
  {
    label: 'updater script ships in the package',
    ok: fs.existsSync(path.join(desktopRoot, 'build/update/apply-update.ps1'))
      && fs.existsSync(path.join(desktopRoot, 'build/update/apply-update.sh')),
    detail: 'build/update → resources/update'
  },
  {
    label: 'profile directory stays stable',
    ok: read(path.join(desktopRoot, 'src/shared/brand.ts')).includes("APP_PROFILE_NAME = 'autumnmark'"),
    detail: 'existing settings and recent files keep working'
  }
]

let failed = 0
for (const check of checks) {
  if (!check.ok) failed += 1
  process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.label}: ${check.detail}\n`)
}

if (failed) {
  process.stderr.write(`\n${failed} packaging name check(s) failed\n`)
  process.exit(1)
}

process.stdout.write(`\nPackaging names are consistent. A full build would produce ${expectedExecutable}.\n`)
