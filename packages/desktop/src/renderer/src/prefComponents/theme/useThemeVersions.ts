import { onScopeDispose, shallowRef } from 'vue'
import { sameThemeSnapshot, type ThemeSnapshot } from '@shared/themeVersion'
import { forkThemeVersions, readThemeVersions, writeThemeVersion,
  type ThemeVersion, type ThemeVersionKind } from './themeVersions'

export function useThemeVersions(uuid: string, syncCurrent = true) {
  const entries = shallowRef<ThemeVersion[]>([])
  let visible = false
  let pending = Promise.resolve()

  function enqueue<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const next = pending.then(operation)
    pending = next.then(() => undefined)
    return next
  }

  async function refresh(): Promise<void> {
    if (visible) entries.value = await readThemeVersions(uuid)
  }

  function record(kind: ThemeVersionKind, before: ThemeSnapshot, snapshot: ThemeSnapshot,
    options: { restoredAt?: number; revision?: string } = {}): Promise<ThemeVersion | undefined> {
    if (kind !== 'save' && kind !== 'apply' && kind !== 'restore' && sameThemeSnapshot(before, snapshot)) return pending.then(() => undefined)
    const time = Date.now()
    return enqueue(async() => {
      const version = await writeThemeVersion(uuid, before, time, {
        kind, snapshot, restoredAt: options.restoredAt, ...(options.revision ? { revision: options.revision } : {})
      }, syncCurrent)
      await refresh()
      return version
    })
  }

  function ensure(snapshot: ThemeSnapshot): Promise<void> {
    return enqueue(async() => {
      await writeThemeVersion(uuid, snapshot, Date.now(), undefined, syncCurrent)
      await refresh()
    })
  }

  function fork(next: string, kind: 'save' | 'apply', before: ThemeSnapshot, snapshot: ThemeSnapshot): Promise<void> {
    const time = Date.now()
    return enqueue(async() => {
      await writeThemeVersion(uuid, before, time)
      await forkThemeVersions(uuid, next, time, kind, snapshot)
    })
  }

  return { entries, record, fork, ensure, whenIdle: () => pending,
    open: (snapshot: ThemeSnapshot) => { visible = true; return ensure(snapshot) },
    close: () => { visible = false } }
}
