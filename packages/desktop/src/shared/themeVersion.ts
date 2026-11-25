import { parse } from 'postcss'
import type { LocalTheme } from './localTheme'

export interface ThemeSnapshot {
  name: string
  base: string
  css: string
  sample: string | null
  previewCss?: string
}

export type ThemeVersionKind = 'initial' | 'manual' | 'ai' | 'save' | 'apply' | 'restore' | 'undo' | 'collaboration' | 'recovered'
export type ThemeVersionRecord = {
  uuid: string; time: number; kind: ThemeVersionKind; snapshot: ThemeSnapshot
  previous?: ThemeSnapshot; restoredAt?: number; summary?: string
}
export type ThemeVersion = ThemeVersionRecord & { id: number; revision: string }
export type AppliedThemeVersion = ThemeVersion & { theme: LocalTheme }

export interface AppliedThemeHistory {
  themeId: string
  revision: string
  current: ThemeSnapshot
  entries: AppliedThemeVersion[]
}

export interface ThemeVersionChange {
  field: 'name' | 'base' | 'css' | 'sample'
  location?: string
  before: string | null
  after: string | null
}

export function sameThemeSnapshot(a: ThemeSnapshot, b: ThemeSnapshot): boolean {
  return a.name === b.name && a.base === b.base && a.css === b.css && a.sample === b.sample && a.previewCss === b.previewCss
}

function declarations(css: string): Map<string, string> {
  const values = new Map<string, string[]>()
  parse(css).walkDecls(declaration => {
    const path = [declaration.prop]
    let parent = declaration.parent
    while (parent && parent.type !== 'root') {
      if (parent.type === 'rule') path.unshift(parent.selector)
      if (parent.type === 'atrule') path.unshift(`@${parent.name} ${parent.params}`.trimEnd())
      parent = parent.parent
    }
    const key = path.join(' › ')
    const value = declaration.value + (declaration.important ? ' !important' : '')
    const existing = values.get(key)
    if (existing) existing.push(value)
    else values.set(key, [value])
  })
  return new Map(Array.from(values, ([key, values]) => [key, values.join('\n')]))
}

function changedLines(before: string | null, after: string | null): Pick<ThemeVersionChange, 'before' | 'after'> {
  if (before === null || after === null) return { before, after }
  const left = before.split('\n')
  const right = after.split('\n')
  const limit = Math.min(left.length, right.length)
  let start = 0
  while (start < limit && left[start] === right[start]) start++
  let end = 0
  while (end < limit - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  return { before: left.slice(start, left.length - end).join('\n'), after: right.slice(start, right.length - end).join('\n') }
}

export function themeVersionChanges(before: ThemeSnapshot, after: ThemeSnapshot): ThemeVersionChange[] {
  const changes: ThemeVersionChange[] = []
  for (const field of ['name', 'base'] as const) {
    if (before[field] !== after[field]) changes.push({ field, before: before[field], after: after[field] })
  }
  if (before.css !== after.css) {
    try {
      const left = declarations(before.css)
      const right = declarations(after.css)
      for (const location of new Set([...left.keys(), ...right.keys()])) {
        const previous = left.get(location) ?? null
        const current = right.get(location) ?? null
        if (previous !== current) changes.push({ field: 'css', location, before: previous, after: current })
      }
    } catch { /* Incomplete CSS is still recoverable as source text. */ }
    if (!changes.some(change => change.field === 'css')) changes.push({ field: 'css', ...changedLines(before.css, after.css) })
  }
  if (before.sample !== after.sample) changes.push({ field: 'sample', ...changedLines(before.sample, after.sample) })
  return changes
}
