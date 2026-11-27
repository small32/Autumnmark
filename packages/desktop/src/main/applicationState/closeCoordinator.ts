import type { SessionState, WindowSnapshot } from '@shared/types/applicationState'
import { unsavedDocuments } from '@shared/applicationState/startupPlan'
import { createStateId } from './identity'

export class WindowCloseCanceled extends Error {}

/** Native close operations; persistence must succeed before any window is destroyed. */
export interface ClosePorts {
  getSession(): SessionState
  checkpoint(windowId: string, transactionId: string): Promise<WindowSnapshot>
  choose(snapshot: WindowSnapshot, transactionId: string): Promise<'save' | 'discard' | 'cancel'>
  save(snapshot: WindowSnapshot): Promise<'saved' | 'canceled' | 'failed'>
  // The owner validates every prepared document and applies discards in one serialized commit.
  commit(snapshots: WindowSnapshot[], windowId?: string): Promise<boolean>
  destroy(windowId: string): Promise<void>
}

/** Discard consent applies only to the document revisions seen in the prompt. */
interface PreparedWindow {
  snapshot: WindowSnapshot
  discarded: Map<string, number>
}

const QUIT_KEY = '__quit__'

export class CloseCoordinator {
  /** Close flows that are currently running, keyed by window id (or the quit key). */
  private _pending = new Set<string>()
  /** Serializes close flows so checkpoints and commits never overlap. */
  private _chain: Promise<void> = Promise.resolve()

  constructor(private readonly _ports: ClosePorts) {}

  private async _capture(windowId: string, transactionId: string): Promise<WindowSnapshot> {
    const snapshot = await this._ports.checkpoint(windowId, transactionId)
    if (snapshot.id !== windowId) throw new Error('Close checkpoint belongs to another window')
    return snapshot
  }

  async closeWindow(windowId: string): Promise<void> {
    if (!windowId) throw new Error('Window identity is required')
    await this._requestClose(windowId)
  }

  quit(): Promise<boolean> {
    return this._requestClose()
  }

  private async _requestClose(windowId?: string): Promise<boolean> {
    // A repeated request for the same target is idempotent, but a request for
    // another window must not be dropped: it waits for the running flow and
    // then closes its own window.
    const key = windowId ?? QUIT_KEY
    if (this._pending.has(key)) return false
    this._pending.add(key)
    try {
      const run = this._chain.then(() => this._runClose(windowId))
      this._chain = run.then(() => {}, () => {})
      return await run
    } finally {
      this._pending.delete(key)
    }
  }

  private async _runClose(windowId?: string): Promise<boolean> {
    try {
      const initial = this._ports.getSession()
      const windows = structuredClone(
        windowId ? initial.windows.filter((window) => window.id === windowId) : initial.windows
      )
      if (windowId && windows.length === 0) return false
      const transactionId = createStateId()
      const prepared: PreparedWindow[] = []
      for (const window of windows) {
        let snapshot = await this._capture(window.id, transactionId)
        let dirty = unsavedDocuments(snapshot)
        const discarded = new Map<string, number>()
        if (dirty.length > 0) {
          const choice = await this._ports.choose(snapshot, transactionId)
          if (choice === 'cancel') return false
          if (choice === 'save') {
            const result = await this._ports.save(snapshot)
            if (result !== 'saved') return false
            snapshot = await this._capture(window.id, transactionId)
            dirty = unsavedDocuments(snapshot)
            if (dirty.length > 0) return false
          } else {
            for (const document of dirty) {
              if (document.content.kind === 'recovery')
                discarded.set(document.id, document.content.contentRevision)
            }
          }
        }
        prepared.push({ snapshot, discarded })
      }
      // Other windows can change while their neighbors' dialogs are being answered.
      for (const entry of prepared) {
        const latest = await this._capture(entry.snapshot.id, transactionId)
        const unexpected = unsavedDocuments(latest).some(
          (document) =>
            document.content.kind === 'recovery' &&
            entry.discarded.get(document.id) !== document.content.contentRevision
        )
        if (unexpected) return false
        entry.snapshot = latest
      }
      const committed = await this._ports.commit(
        prepared.map((entry) => entry.snapshot),
        windowId
      )
      if (!committed) return false
      for (const entry of prepared) await this._ports.destroy(entry.snapshot.id)
      return true
    } catch (error) {
      if (!(error instanceof WindowCloseCanceled)) throw error
      return false
    }
  }
}
