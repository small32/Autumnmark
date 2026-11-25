import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { LocalTheme } from '@shared/localTheme'
import { createActiveThemeVersions } from 'main_renderer/ipc/activeThemeVersions'

test('an interrupted theme history write records the edit only when the preferences match', async() => {
  const directory = await mkdtemp(join(tmpdir(), 'autumnmark-active-theme-versions-'))
  try {
    const before: LocalTheme = {
      version: 1, id: 'local:light:8dc5f09e-3100-48b9-b640-39066d92b6ad',
      name: 'Original', base: 'light', values: { h2: '#123456' }
    }
    const after = { ...before, css: 'h2 { color: #654321; }' }
    const archive = createActiveThemeVersions(directory)
    archive.stage(after, before, { before, kind: 'collaboration' })

    expect(createActiveThemeVersions(directory).list(before).map(entry => entry.kind)).toEqual(['initial'])
    const committed = createActiveThemeVersions(directory).list(after)
    expect(committed.map(entry => entry.kind)).toEqual(['collaboration', 'initial'])
    expect(committed[1].snapshot.css).toContain('#123456')
    expect(archive.find(after, committed[1].revision)?.theme.values).toEqual(before.values)

    const latest = { ...after, css: 'h2 { color: #ab124d; }' }
    const complete = archive.stage(latest, after, { before: after, kind: 'collaboration' })
    complete()
    expect(createActiveThemeVersions(directory).list(latest).map(entry => entry.kind))
      .toEqual(['collaboration', 'collaboration', 'initial'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
