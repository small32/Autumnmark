import { describe, expect, it, vi } from 'vitest'
import { fetchRemoteContent, RemoteContentCache } from '../../../src/main/ipc/remoteContent'

describe('remote about content', () => {
  it('keeps the KeyDoing mirror order and falls back to GitHub Raw', async() => {
    const markdown = '## 动态信息'
    const fetchSource = vi.fn(async(url: string) => {
      const { hostname } = new URL(url)
      if (hostname === 'raw.githubusercontent.com') return new Response(markdown)
      if (hostname === 'proxy.gitwarp.top') return new Response('<html>Unavailable</html>')
      if (hostname === 'ghfast.top') throw new Error('connection timed out')
      return new Response(null, { status: 503 })
    })

    await expect(fetchRemoteContent('about', fetchSource)).resolves.toEqual({
      markdown
    })
    const urls = fetchSource.mock.calls.map(([url]) => new URL(url))
    expect(urls.map(({ hostname }) => hostname)).toEqual([
      'proxy.gitwarp.top',
      'ghfast.top',
      'gh-proxy.org',
      'v4.gh-proxy.org',
      'v6.gh-proxy.org',
      'cdn.gh-proxy.org',
      'raw.githubusercontent.com'
    ])
    expect(urls.every(({ pathname }) => pathname.endsWith('/Autumn-one/notify/main/info.md'))).toBe(true)
  })

  it('accepts only the about feed across IPC', async() => {
    const fetchSource = vi.fn()
    const cache = new RemoteContentCache(fetchSource)

    await expect(cache.load('https://example.com')).resolves.toEqual({
      content: null,
      status: 'failed'
    })
    await expect(cache.load('announcement')).resolves.toEqual({
      content: null,
      status: 'failed'
    })
    expect(fetchSource).not.toHaveBeenCalled()
  })

  it('shares the startup download with early opens and serves the warmed content on later opens', async() => {
    const fetchSource = vi.fn(async() => new Response('## 动态信息'))
    const cache = new RemoteContentCache(fetchSource)

    const prefetch = cache.load('about')
    const earlyOpen = cache.load('about')
    expect(fetchSource).toHaveBeenCalledTimes(1)

    const about = await prefetch
    await expect(earlyOpen).resolves.toEqual(about)
    await expect(cache.load('about')).resolves.toEqual(about)
    expect(fetchSource).toHaveBeenCalledTimes(1)
  })

  it('allows a first open to retry a failed prefetch and keeps the warmed content if refresh fails', async() => {
    const fetchSource = vi.fn(async() => new Response(null, { status: 503 }))
    const cache = new RemoteContentCache(fetchSource)

    await expect(cache.load('about')).resolves.toEqual({ content: null, status: 'failed' })
    fetchSource.mockResolvedValueOnce(new Response('## 动态信息'))
    const content = { markdown: '## 动态信息' }
    await expect(cache.load('about')).resolves.toEqual({ content, status: 'ready' })
    await expect(cache.load('about', true)).resolves.toEqual({ content, status: 'failed' })
  })
})
