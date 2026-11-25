import { sameThemeSnapshot, type ThemeSnapshot, type ThemeVersion, type ThemeVersionRecord } from '@shared/themeVersion'
export type { ThemeVersion, ThemeVersionKind } from '@shared/themeVersion'

let opening: Promise<IDBDatabase> | undefined

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function database(): Promise<IDBDatabase> {
  opening ??= (async() => {
    const request = indexedDB.open('autumnmark.theme-versions', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('versions', { keyPath: 'id', autoIncrement: true })
      store.createIndex('uuid', 'uuid')
      store.createIndex('revision', 'revision')
    }
    const db = await result(request)
    db.onclose = () => { opening = undefined }
    return db
  })().catch(error => {
    opening = undefined
    throw error
  })
  return opening
}

async function write<T>(update: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await database()
  const tx = db.transaction('versions', 'readwrite', { durability: 'strict' })
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  const [value] = await Promise.all([update(tx.objectStore('versions')), committed])
  return value
}

async function add(store: IDBObjectStore, record: ThemeVersionRecord & { revision?: string }): Promise<ThemeVersion> {
  const version = { revision: crypto.randomUUID(), ...record }
  const id = await result(store.add(version)) as number
  return { ...version, id }
}

export async function readThemeVersions(uuid: string): Promise<ThemeVersion[]> {
  const db = await database()
  const entries = await result<ThemeVersion[]>(db.transaction('versions').objectStore('versions').index('uuid').getAll(uuid))
  return entries.reverse()
}

export function writeThemeVersion(uuid: string, before: ThemeSnapshot, time: number,
  entry?: Pick<ThemeVersionRecord, 'kind' | 'snapshot' | 'restoredAt'> & { revision?: string }, syncCurrent = true): Promise<ThemeVersion | undefined> {
  return write(async store => {
    if (entry?.revision) {
      const matches = await result<ThemeVersion[]>(store.index('revision').getAll(entry.revision))
      const existing = matches.find(version => version.uuid === uuid)
      if (existing) return existing
    }
    const cursor = await result(store.index('uuid').openCursor(uuid, 'prev'))
    const latest = cursor?.value as ThemeVersion | undefined
    const diverged = latest && !sameThemeSnapshot(latest.snapshot, before)
    if (!latest || (diverged && syncCurrent)) {
      await add(store, { uuid, time, kind: latest ? 'recovered' : 'initial', snapshot: before })
    }
    if (entry) return add(store, { uuid, time, ...entry, ...(diverged && !syncCurrent ? { previous: before } : {}) })
  })
}

export function forkThemeVersions(source: string, uuid: string, time: number, kind: 'save' | 'apply', snapshot: ThemeSnapshot): Promise<void> {
  return write(async store => {
    const entries = await result<ThemeVersion[]>(store.index('uuid').getAll(source))
    for (const { id: _id, ...version } of entries) await add(store, { ...version, uuid })
    await add(store, { uuid, time, kind, snapshot })
  })
}

export function updateThemeVersionSummary(revision: string, summary: string): Promise<void> {
  return write(async store => {
    const entries = await result<ThemeVersion[]>(store.index('revision').getAll(revision))
    await Promise.all(entries.map(entry => result(store.put({ ...entry, summary }))))
  })
}

export function removeThemeVersions(uuid: string): Promise<void> {
  return write(async store => {
    const ids = await result(store.index('uuid').getAllKeys(uuid))
    await Promise.all(ids.map(id => result(store.delete(id))))
  })
}
