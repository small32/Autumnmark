import { mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { LoadResult } from '@shared/types/applicationState'
import { UnsupportedStateVersion } from './codec'

export interface StorageHooks {
  beforeReplace?: (pathname: string, value: string) => Promise<void>
}

export class AtomicJsonFile<T> {
  private _pending: Promise<void> = Promise.resolve()
  private _initialized = false
  private readonly _fallback: T
  private _protectedReason: 'invalid-data' | 'unreadable' | 'unsupported-version' | null = null

  constructor(
    private readonly _pathname: string,
    private readonly _parse: (value: unknown) => T,
    defaults: () => T,
    private readonly _hooks: StorageHooks = {}
  ) {
    this._fallback = defaults()
  }

  private _enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const task = this._pending.then(operation)
    // A failed write must not prevent a later valid write from being attempted.
    this._pending = task.then(
      () => {},
      () => {}
    )
    return task
  }

  private async _read(): Promise<LoadResult<T>> {
    this._initialized = true
    // "unreadable" may come from a transient condition (anti-virus lock,
    // EMFILE, EAGAIN); retry it on the next read/write instead of disabling
    // writes for the rest of the process. Only invalid/unsupported data is
    // permanently protected.
    if (this._protectedReason === 'unreadable') this._protectedReason = null
    if (this._protectedReason) {
      return {
        status: 'read-only-defaulted',
        value: structuredClone(this._fallback),
        reason: this._protectedReason
      }
    }
    let content: string
    try {
      content = await readFile(this._pathname, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'defaulted', value: structuredClone(this._fallback), reason: 'missing' }
      }
      this._protectedReason = 'unreadable'
      return {
        status: 'read-only-defaulted',
        value: structuredClone(this._fallback),
        reason: 'unreadable'
      }
    }
    try {
      return { status: 'loaded', value: this._parse(JSON.parse(content)) }
    } catch (error) {
      this._protectedReason =
        error instanceof UnsupportedStateVersion ? 'unsupported-version' : 'invalid-data'
      return {
        status: 'read-only-defaulted',
        value: structuredClone(this._fallback),
        reason: this._protectedReason
      }
    }
  }

  load(): Promise<LoadResult<T>> {
    return this._enqueue(() => this._read())
  }

  async write(value: T): Promise<void> {
    // Capture this request before earlier writes or initialization can yield control.
    const serialized = JSON.stringify(this._parse(value))
    return this._enqueue(async() => {
      // Re-attempt an unreadable file: the failure may have been transient, and
      // writing over data we never managed to read would lose it.
      if (!this._initialized || this._protectedReason === 'unreadable') await this._read()
      if (this._protectedReason) throw new Error(`State file is read-only: ${this._protectedReason}`)
      await mkdir(path.dirname(this._pathname), { recursive: true })
      if (this._hooks.beforeReplace) await this._hooks.beforeReplace(this._pathname, serialized)
      await writeFileAtomic(this._pathname, serialized, { encoding: 'utf8', mode: 0o600 })
    })
  }

  remove(validate: (value: T) => void): Promise<void> {
    return this._enqueue(async() => {
      const result = await this._read()
      if (result.status === 'defaulted') return
      if (result.status !== 'loaded') throw new Error('State file is read-only')
      validate(result.value)
      try {
        await unlink(this._pathname)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })
  }
}
