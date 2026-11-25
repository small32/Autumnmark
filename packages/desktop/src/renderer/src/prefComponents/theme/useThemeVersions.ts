import { onScopeDispose, ref, shallowRef } from 'vue'
import { sameThemeSnapshot, themeVersionChanges, type ThemeSnapshot } from '@shared/themeVersion'
import { forkThemeVersions, readThemeVersions, updateThemeVersionSummary, writeThemeVersion,
  type ThemeVersion, type ThemeVersionKind } from './themeVersions'

const summaryEvents = new EventTarget()

export function useThemeVersions(uuid: string, syncCurrent = true) {
  const entries = shallowRef<ThemeVersion[]>([])
  const failed = ref(false)
  let visible = false
  let pending = Promise.resolve()
  const summaryUpdated = (event: Event): void => {
    if (!visible) return
    const { revision, summary } = (event as CustomEvent<{ revision: string; summary: string }>).detail
    entries.value = entries.value.map(entry => entry.revision === revision ? { ...entry, summary } : entry)
  }
  summaryEvents.addEventListener('summary', summaryUpdated)
  onScopeDispose(() => summaryEvents.removeEventListener('summary', summaryUpdated))

  function enqueue<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const next = pending.then(operation).catch(() => {
      failed.value = true
      return undefined
    })
    pending = next.then(() => undefined)
    return next
  }

  async function refresh(): Promise<void> {
    if (visible) entries.value = await readThemeVersions(uuid)
  }

  async function summarize(version: ThemeVersion, before: ThemeSnapshot, profile: string, locale: string): Promise<void> {
    const changes = themeVersionChanges(before, version.snapshot).slice(0, 24).map(change => ({ ...change,
      location: change.location?.slice(0, 200), before: change.before?.slice(0, 500) ?? null, after: change.after?.slice(0, 500) ?? null }))
    if (!changes.length) return
    let summary: string
    try { summary = await window.electron.ipcRenderer.invoke('mt::theme::summarize-version', profile, locale, changes) }
    catch { return }
    if (!summary) return
    await enqueue(async() => {
      await updateThemeVersionSummary(version.revision, summary)
      summaryEvents.dispatchEvent(new CustomEvent('summary', { detail: { revision: version.revision, summary } }))
    })
  }

  function record(kind: ThemeVersionKind, before: ThemeSnapshot, snapshot: ThemeSnapshot,
    options: { restoredAt?: number; revision?: string; model?: { profile: string; locale: string } } = {}): Promise<ThemeVersion | undefined> {
    if (kind !== 'save' && kind !== 'apply' && kind !== 'restore' && sameThemeSnapshot(before, snapshot)) return pending.then(() => undefined)
    const time = Date.now()
    return enqueue(async() => {
      const version = await writeThemeVersion(uuid, before, time, {
        kind, snapshot, restoredAt: options.restoredAt, ...(options.revision ? { revision: options.revision } : {})
      }, syncCurrent)
      if (version && !version.summary && options.model) void summarize(version, before, options.model.profile, options.model.locale)
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

  return { entries, failed, record, fork, ensure, whenIdle: () => pending,
    open: (snapshot: ThemeSnapshot) => { visible = true; failed.value = false; return ensure(snapshot) },
    close: () => { visible = false } }
}
