import { parse, CssSyntaxError } from 'postcss'
import { tokenize, isTokenAtKeyword, isTokenBadURL, isTokenFunction, isTokenURL } from '@csstools/css-tokenizer'

export const maxThemeCss = 64 * 1024
const resourceFunctions = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set'])

export function themeCssIssue(css: string): string {
  if (css.length > maxThemeCss) return '64 KiB'
  try {
    let malformed = false
    const tokens = tokenize({ css }, { onParseError: () => { malformed = true } })
    if (malformed) return 'CSS'
    for (const token of tokens) {
      if (isTokenURL(token) || isTokenBadURL(token)) return 'url()'
      if (isTokenFunction(token) && resourceFunctions.has(token[4].value.toLowerCase())) return token[4].value + '()'
      if (isTokenAtKeyword(token) && ['import', 'namespace'].includes(token[4].value.toLowerCase())) return '@' + token[4].value
    }
    const root = parse(css, { from: undefined })
    if (root.nodes.some(node => node.type === 'decl')) return 'CSS'
    return ''
  } catch (error) {
    return error instanceof CssSyntaxError ? `${error.line}:${error.column} · ${error.reason}` : 'CSS'
  }
}

/** BrowserWindow needs a literal color before the renderer can resolve the theme cascade. */
export function themeWindowBackground(css: string): string | undefined {
  let color: string | undefined
  for (const node of parse(css).nodes) {
    if (node.type !== 'rule' || node.selector !== ':root') continue
    for (const item of node.nodes) {
      if (item.type === 'decl' && item.prop === '--editorBgColor')
        color = /^#[\da-f]{6}$/i.test(item.value) ? item.value : undefined
    }
  }
  return color
}
