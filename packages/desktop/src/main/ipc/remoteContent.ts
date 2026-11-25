import type { RemoteContent, RemoteContentKind, RemoteContentSnapshot } from '@shared/types/ipc'

const REPOSITORY = 'Autumn-one/notify'
const BRANCH = 'main'
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}`
const FILES: Record<RemoteContentKind, string> = {
  about: 'info.md'
}

// KeyDoing's personalInfoSources share this priority order.
const MIRROR_PREFIXES = [
  'https://proxy.gitwarp.top/',
  'https://ghfast.top/',
  'https://gh-proxy.org/',
  'https://v4.gh-proxy.org/',
  'https://v6.gh-proxy.org/',
  'https://cdn.gh-proxy.org/',
  ''
]
const MAX_MARKDOWN_BYTES = 512 * 1024
const SOURCE_TIMEOUT_MS = 5000

type FetchSource = (url: string, init: RequestInit) => Promise<Response>

const readBody = async(response: Response, limit: number): Promise<string | null> => {
  const reader = response.body?.getReader()
  if (!reader) return null

  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()

      bytes += value.byteLength
      if (bytes > limit) return null
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const downloadMarkdown = async(
  url: URL,
  fetchSource: FetchSource
): Promise<string | null> => {
  try {
    const response = await fetchSource(url.href, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Accept: 'text/plain, text/markdown',
        'User-Agent': 'AutumnMark+'
      }
    })
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel()
      return null
    }

    const markdown = await readBody(response, MAX_MARKDOWN_BYTES)
    if (markdown === null) return null

    return markdown.trim() && !/^\s*<(?:!doctype\b|html[\s>])/i.test(markdown) ? markdown : null
  } catch {
    return null
  }
}

export const fetchRemoteContent = async(
  kind: RemoteContentKind,
  fetchSource: FetchSource
): Promise<RemoteContent | null> => {
  const filename = FILES[kind]
  const cacheBuster = Date.now().toString()

  for (const prefix of MIRROR_PREFIXES) {
    const url = new URL(`${prefix}${RAW_BASE}/${filename}`)
    url.searchParams.set('_', cacheBuster)
    const markdown = await downloadMarkdown(url, fetchSource)
    if (markdown) return { markdown }
  }

  return null
}

export class RemoteContentCache {
  private readonly cached = new Map<RemoteContentKind, RemoteContentSnapshot>()
  private readonly inFlight = new Map<RemoteContentKind, Promise<RemoteContentSnapshot>>()

  constructor(private readonly fetchSource: FetchSource) {}

  async load(kind: unknown, refresh = false): Promise<RemoteContentSnapshot> {
    if (kind !== 'about') {
      return { content: null, status: 'failed' }
    }

    const pending = this.inFlight.get(kind)
    if (pending) return pending

    const cached = this.cached.get(kind)
    if (cached && !refresh) return cached

    const request = this.update(kind, cached?.content ?? null)
    this.inFlight.set(kind, request)
    try {
      return await request
    } finally {
      this.inFlight.delete(kind)
    }
  }

  private async update(
    kind: RemoteContentKind,
    previous: RemoteContent | null
  ): Promise<RemoteContentSnapshot> {
    const fetched = await fetchRemoteContent(kind, this.fetchSource)
    const content = fetched ?? previous
    const snapshot: RemoteContentSnapshot = {
      content,
      status: fetched ? 'ready' : 'failed'
    }
    if (content) {
      this.cached.set(kind, snapshot)
    }
    return snapshot
  }
}
