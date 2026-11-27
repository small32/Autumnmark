import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerFsHandlers } from 'main_renderer/ipc/fs'

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle } }))

let directory: string
let copy: (event: object, src: string, dest: string, overwrite?: boolean) => Promise<void>

beforeEach(async() => {
  handle.mockClear()
  registerFsHandlers()
  copy = handle.mock.calls.find(([channel]) => channel === 'mt::fs::copy')?.[1]
  directory = await mkdtemp(join(tmpdir(), 'autumnmark-sidebar-copy-'))
})

afterEach(async() => {
  await rm(directory, { recursive: true, force: true })
})

it('refuses to overwrite an existing destination document during sidebar paste', async() => {
  const source = join(directory, 'a.md')
  const destination = join(directory, 'b.md')
  await writeFile(source, 'source')
  await writeFile(destination, 'destination')

  await expect(copy({}, source, destination, false)).rejects.toThrow('already exists')
  expect(await readFile(destination, 'utf8')).toBe('destination')

  await copy({}, source, destination)
  expect(await readFile(destination, 'utf8')).toBe('source')
})

it('copies a directory once when two pastes claim the same destination', async() => {
  const source = join(directory, 'source')
  const destination = join(directory, 'destination')
  await mkdir(source)
  await writeFile(join(source, 'note.md'), 'source')

  const results = await Promise.allSettled([
    copy({}, source, destination, false),
    copy({}, source, destination, false)
  ])
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(await readFile(join(destination, 'note.md'), 'utf8')).toBe('source')

  await writeFile(join(source, 'extra.md'), 'extra')
  await writeFile(join(destination, 'note.md'), 'destination')
  await expect(copy({}, source, destination, false)).rejects.toThrow('already exists')
  expect(await readdir(destination)).toEqual(['note.md'])
  expect(await readFile(join(destination, 'note.md'), 'utf8')).toBe('destination')
})
