import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import log from 'electron-log'
import writeAtomic from 'write-file-atomic'
import { isLocalTheme, type LocalTheme } from '@shared/localTheme'
import { localThemeCss } from '@shared/themeOverrides'
import type { AppliedThemeVersion, ThemeSnapshot, ThemeVersion } from '@shared/themeVersion'

export interface AppliedThemeChange {
  before: LocalTheme | undefined
  kind: 'ai' | 'collaboration' | 'restore'
  restoredAt?: number
}

type StoredVersion = Pick<ThemeVersion, 'id' | 'revision' | 'time' | 'kind' | 'restoredAt'> & { theme: LocalTheme }
type VersionFile = { versions: StoredVersion[]; pending?: StoredVersion }

export function appliedThemeSnapshot(theme: LocalTheme): ThemeSnapshot {
  return { name: theme.name, base: theme.base, css: localThemeCss(theme), sample: null }
}

function normalized(theme: LocalTheme): LocalTheme {
  return { ...theme, css: theme.css ?? '' }
}

function validVersion(value: unknown, id: string): value is StoredVersion {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<StoredVersion>
  return typeof entry.id === 'number' && Number.isSafeInteger(entry.id) && entry.id > 0 &&
    typeof entry.revision === 'string' && entry.revision.length === 36 &&
    typeof entry.time === 'number' && Number.isSafeInteger(entry.time) && entry.time >= 0 &&
    (entry.kind === 'initial' || entry.kind === 'recovered' || entry.kind === 'ai' || entry.kind === 'collaboration' || entry.kind === 'restore') &&
    (entry.restoredAt === undefined || (Number.isSafeInteger(entry.restoredAt) && entry.restoredAt >= 0)) &&
    isLocalTheme(entry.theme) && entry.theme.id === id
}

export function createActiveThemeVersions(userDataPath: string) {
  const directory = join(userDataPath, 'applied-theme-versions')
  const filename = (id: string): string => join(directory, id.replaceAll(':', '-') + '.json')

  function read(id: string, saved?: LocalTheme): StoredVersion[] {
    try {
      const path = filename(id)
      if (!lstatSync(path).isFile()) throw new Error('invalid-theme-history')
      const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<VersionFile> | null
      if (!data || !Array.isArray(data.versions) || !data.versions.every(entry => validVersion(entry, id)) ||
        (data.pending !== undefined && !validVersion(data.pending, id))) throw new Error('invalid-theme-history')
      if (data.pending && saved && isDeepStrictEqual(data.pending.theme, normalized(saved))) {
        return [...data.versions, data.pending]
      }
      return data.versions
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw error
    }
  }

  function write(id: string, data: VersionFile): void {
    mkdirSync(directory, { recursive: true })
    writeAtomic.sync(filename(id), JSON.stringify(data), { mode: 0o600 })
  }

  function stage(theme: LocalTheme, saved: LocalTheme | undefined, change: AppliedThemeChange): () => void {
    const id = theme.id
    const previous = change.before
    const before = normalized(previous?.id === id ? previous : { ...theme, css: previous?.css, values: previous?.values ?? {} })
    const versions = read(id, saved)
    const latest = versions.at(-1)
    const time = Date.now()
    let number = latest?.id ?? 0
    if (!latest || !isDeepStrictEqual(latest.theme, before)) {
      versions.push({ id: ++number, revision: randomUUID(), time, kind: latest ? 'recovered' : 'initial', theme: before })
    }
    const pending: StoredVersion = {
      id: number + 1, revision: randomUUID(), time, kind: change.kind, theme: normalized(theme), restoredAt: change.restoredAt
    }
    // A staged edit is visible only once preferences contain the exact saved theme.
    write(id, { versions, pending })
    return () => {
      try { write(id, { versions: [...versions, pending] }) }
      catch (error) { log.warn('Could not finish recording an applied theme version', error) }
    }
  }

  function list(theme: LocalTheme): AppliedThemeVersion[] {
    const uuid = theme.id.split(':')[2]
    return read(theme.id, theme).reverse().map(({ theme, ...entry }) => ({
      ...entry, uuid, theme, snapshot: appliedThemeSnapshot(theme)
    }))
  }

  function find(theme: LocalTheme, revision: string): StoredVersion | undefined {
    return read(theme.id, theme).find(entry => entry.revision === revision)
  }

  function remove(theme: LocalTheme): void {
    try { rmSync(filename(theme.id), { force: true }) }
    catch (error) { log.warn('Could not delete applied theme history', error) }
  }

  return { stage, list, find, remove }
}
