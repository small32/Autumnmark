'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadIndex, search, type IndexedPage, type SearchHit } from '@/lib/docs-search'
import { SearchIcon } from '@/components/Icons'

type Props = {
  open: boolean
  onClose: () => void
}

type HitGroup = { key: string; label: string; tab: IndexedPage['tab']; hits: SearchHit[] }

export default function CommandPalette({ open, onClose }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [index, setIndex] = useState<IndexedPage[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    let active = true
    setError(null)
    setQuery('')
    setSelected(0)
    inputRef.current?.focus()
    loadIndex()
      .then((data) => {
        if (active) setIndex(data)
      })
      .catch((err: Error) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [open])

  const hits: SearchHit[] = useMemo(() => {
    if (!index) return []
    if (!query.trim()) {
      return index.map((page) => ({
        page,
        score: 0,
        snippet: page.hint ?? page.body.slice(0, 120)
      }))
    }
    return search(query, index)
  }, [index, query])

  const groups = useMemo(() => groupHits(hits), [hits])
  const visibleHits = useMemo(() => groups.flatMap((group) => group.hits), [groups])
  const selectedHit = visibleHits[selected]

  const navigateTo = useCallback(
    (hit: SearchHit) => {
      const href = hit.headingId ? hit.page.href + '#' + hit.headingId : hit.page.href
      router.push(href)
      onClose()
    },
    [router, onClose]
  )

  useEffect(() => {
    if (!open) return
    function onKey(ev: KeyboardEvent) {
      if (ev.isComposing) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
        return
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault()
        setSelected((s) => Math.min(s + 1, Math.max(0, visibleHits.length - 1)))
        return
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
        return
      }
      if (ev.key === 'Enter') {
        ev.preventDefault()
        if (selectedHit) navigateTo(selectedHit)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, navigateTo, selectedHit, visibleHits.length])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector('.kbar-item.sel') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedHit, open])

  return (
    <div className={'kbar-scrim' + (open ? ' open' : '')} onClick={onClose} inert={!open}>
      <div
        className="kbar"
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kbar-input">
          <SearchIcon aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documentation…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
          />
          <span className="esc">esc</span>
        </div>
        <div className="kbar-results" ref={listRef}>
          {error && <div className="kbar-empty">Could not load search index: {error}</div>}
          {!error && hits.length === 0 && index && (
            <div className="kbar-empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {!error && !index && <div className="kbar-empty">Loading…</div>}
          {groups.map((group) => (
            <div key={group.key}>
              <div className="kbar-sec">{group.label}</div>
              {group.hits.map((hit) => (
                <ResultItem
                  key={hit.page.slug}
                  hit={hit}
                  selected={hit === selectedHit}
                  onHover={() => setSelected(visibleHits.indexOf(hit))}
                  onClick={() => navigateTo(hit)}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="kbar-foot">
          <span className="kk">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            navigate
          </span>
          <span className="kk">
            <kbd>↵</kbd>
            open
          </span>
          <span className="kk">
            <kbd>esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}

function groupHits(hits: SearchHit[]): HitGroup[] {
  const order: Record<IndexedPage['tab'], number> = { user: 0, dev: 1 }
  const map = new Map<string, HitGroup>()
  for (const hit of hits) {
    const { tab, tabLabel, group } = hit.page
    const key = `${tab}::${group}`
    let bucket = map.get(key)
    if (!bucket) {
      bucket = { key, label: `${tabLabel} · ${group}`, tab, hits: [] }
      map.set(key, bucket)
    }
    bucket.hits.push(hit)
  }
  return Array.from(map.values()).sort((a, b) => order[a.tab] - order[b.tab])
}

function ResultItem({
  hit,
  selected,
  onHover,
  onClick
}: {
  hit: SearchHit
  selected: boolean
  onHover: () => void
  onClick: () => void
}) {
  return (
    <div
      className={'kbar-item' + (selected ? ' sel' : '')}
      onMouseEnter={onHover}
      onClick={onClick}
      role="option"
      aria-selected={selected}
    >
      <span className="ki">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      </span>
      <span className="kt">
        <b>{hit.page.title}</b>
        {hit.snippetHtml ? (
          <span dangerouslySetInnerHTML={{ __html: hit.snippetHtml }} />
        ) : (
          <span>{hit.snippet}</span>
        )}
      </span>
      <span className="kgo">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </span>
    </div>
  )
}
