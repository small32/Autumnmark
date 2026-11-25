import { isDarkThemeId, oneDarkThemes, pineInkTheme, railscastsThemes } from '../common/theme'
import { themeCssIssue } from './themeCss'
import type { UserPreferences, UserPreferencesPatch } from './types/preferences'

export const lightBases = ['ayu-light', 'catppuccin-latte', 'everforest-light', 'light', 'graphite', 'gruvbox-light',
  pineInkTheme.id, 'rose-pine-dawn', 'solarized-light', 'tokyo-night-light', 'ulysses']
export const themeBases = [...lightBases, ...railscastsThemes, ...oneDarkThemes].sort()

export const themeSelectionPatch = (prefs: Pick<UserPreferences, 'followSystemTheme'>, id: string, systemIsDark: boolean): UserPreferencesPatch => {
  if (!prefs.followSystemTheme) return { theme: id }
  const dark = isDarkThemeId(id)
  return { [dark ? 'darkModeTheme' : 'lightModeTheme']: id, ...(dark === systemIsDark ? { theme: id } : {}) }
}

export const themeFields = {
  background: 'color', text: 'color', accent: 'color', sidebar: 'color', sidebarText: 'color',
  fontSize: 'size', lineHeight: 'spacing',
  h1: 'color', h2: 'color', h3: 'color', h4: 'color', h5: 'color', h6: 'color', h2Decoration: 'decoration',
  quote: 'color', quoteBorder: 'color', codeBackground: 'color', sourceBackground: 'color', sourceText: 'color'
} as const

export type ThemeField = keyof typeof themeFields
export type ThemeValues = Partial<Record<ThemeField, string>>
export interface LocalTheme {
  version: 1
  id: string
  name: string
  css?: string
  base: string
  values: ThemeValues
  catalog?: CatalogThemeSource
}
export interface CatalogThemeSource {
  id: string
  revision: number
}
export const isCatalogThemeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(value)

export const isCatalogThemeSource = (value: unknown): value is CatalogThemeSource => {
  if (!value || typeof value !== 'object') return false
  const { id, revision } = value as Partial<CatalogThemeSource>
  return isCatalogThemeId(id) && typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
}
export interface ThemeMessage { role: 'user' | 'assistant'; content: string }
export const maxThemeNameLength = 80
export const maxThemeMessageLength = 4000
export const maxThemeSampleLength = 16000
export const isThemeSample = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= maxThemeSampleLength

export interface ThemeModelRequest {
  id: string
  profileId: string
  base: string
  css: string
  baseCss: string
  messages: ThemeMessage[]
  sampleMarkdown?: string
  previewTools?: { baseUrl: string }
}
export interface PreviewTarget {
  framing: 'node' | 'viewport'
  selector: string
  occurrence: number
  slice: number
}
export function isPreviewTarget(value: unknown): value is PreviewTarget {
  if (!value || typeof value !== 'object') return false
  const { framing, selector, occurrence, slice } = value as Partial<PreviewTarget>
  return (framing === 'viewport' || framing === 'node') && typeof selector === 'string' && selector.length <= 256 &&
    (!!selector.trim() || (framing === 'viewport' && slice === 1)) &&
    typeof occurrence === 'number' && Number.isSafeInteger(occurrence) && occurrence > 0 &&
    typeof slice === 'number' && Number.isSafeInteger(slice) && slice > 0
}
/** CSS pixels relative to the preview iframe before the studio's zoom factor is applied. */
export interface PreviewCrop {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  clipped: boolean
  slices: number
}
export type PreparedPreview = { crop: PreviewCrop } | { error: string }
export interface ThemeReplyTrace {
  wireBytes: number
  replyBytes: number
  assistantText: string
}
export interface ThemeChatDiagnostic extends ThemeReplyTrace {
  time: string
  requestId: string
  model: string
  requestType?: string
  phase: string
  reason: string
  inputCss: string
}
export type ThemeCaptureEvent = { prepareCapture: string; target: PreviewTarget; css: string } | { releaseCapture: string }
export type ThemeModelEvent = ThemeCaptureEvent | { css: string } | { sampleMarkdown: string } | { message: string } | { screenshot: string }
export type ThemeGenerationResult = { css: string; sampleMarkdown?: string; reply: string } |
  { diagnostic: ThemeChatDiagnostic } | { cancelled: true }

export const isThemeField = (key: string): key is ThemeField => Object.hasOwn(themeFields, key)
export const validThemeValue = (key: ThemeField, value: unknown): value is string => {
  if (typeof value !== 'string') return false
  switch (themeFields[key]) {
    case 'color': return /^#[\da-f]{6}$/i.test(value)
    case 'size': return /^\d{2}$/.test(value) && +value >= 12 && +value <= 32
    case 'spacing': return /^[12](\.\d{1,2})?$/.test(value) && +value >= 1.2 && +value <= 2.4
    case 'decoration': return ['plain', 'bar', 'tint'].includes(value)
  }
}

export const isThemeValues = (input: unknown): input is ThemeValues =>
  !!input && typeof input === 'object' && !Array.isArray(input) &&
  Object.entries(input).every(([key, value]) => isThemeField(key) && validThemeValue(key, value))

export const isLocalTheme = (input: unknown): input is LocalTheme => {
  if (!input || typeof input !== 'object') return false
  const item = input as Partial<LocalTheme>
  return item.version === 1 && typeof item.base === 'string' && themeBases.includes(item.base) &&
    typeof item.id === 'string' && item.id.startsWith(`local:${item.base}:`) &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.id.split(':')[2] ?? '') &&
    item.id.split(':').length === 3 && typeof item.name === 'string' && !!item.name.trim() &&
    item.name.length <= maxThemeNameLength && isThemeValues(item.values) &&
    (item.catalog === undefined || isCatalogThemeSource(item.catalog)) &&
    (item.css === undefined || (typeof item.css === 'string' && !themeCssIssue(item.css)))
}

export const localThemeList = (value: unknown): LocalTheme[] => Array.isArray(value) ? value.filter(isLocalTheme) : []
