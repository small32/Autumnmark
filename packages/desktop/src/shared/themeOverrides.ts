import { isThemeField, validThemeValue, type ThemeValues, type LocalTheme } from './localTheme'

export const localThemeCss = (theme?: LocalTheme): string =>
  theme ? [themeOverridesCss(theme.values), theme.css].filter(Boolean).join('\n\n') : ''

export const themeOverridesCss = (values: ThemeValues): string => {
  const rules: string[] = []
  const variables = (value: string, ...names: string[]): void => {
    rules.push(`:root { ${names.map(name => `--${name}: ${value};`).join(' ')} }`)
  }
  const prose = ':root .mu-container'
  for (const [key, value] of Object.entries(values)) {
    if (!isThemeField(key) || !validThemeValue(key, value)) continue
    switch (key) {
      case 'background': variables(value, 'editorBgColor', 'editor-bg-color'); break
      case 'text':
        variables(value, 'editorColor', 'editor-color')
        rules.push(`${prose} .mu-paragraph { color: ${value}; }`)
        break
      case 'accent':
        variables(value, 'themeColor', 'theme-color', 'proseAccent', 'linkColor', 'link-color', 'buttonPrimaryBgColor')
        break
      case 'sidebar': variables(value, 'sideBarBgColor'); break
      case 'sidebarText':
        variables(value, 'sideBarColor', 'sideBarTextColor', 'sideBarTitleColor', 'sideBarIconColor')
        rules.push(`:root .side-bar { --editorColor: ${value}; }`)
        break
      case 'fontSize': rules.push(`${prose} .mu-paragraph { font-size: ${value}px; }`); break
      case 'lineHeight': rules.push(`${prose} .mu-paragraph { line-height: ${value}; }`); break
      case 'quote':
        variables(value, 'blockquoteTextColor', 'blockquote-text-color')
        rules.push(`${prose} .mu-block-quote .mu-paragraph { color: ${value}; }`)
        break
      case 'quoteBorder':
        variables(value, 'blockquoteBorderColor', 'blockquote-border-color')
        rules.push(`${prose} .mu-block-quote::before { background-color: ${value}; }`)
        break
      case 'codeBackground':
        variables(value, 'codeBgColor', 'codeBlockBgColor', 'code-bg-color', 'code-block-bg-color')
        rules.push(`${prose} code.mu-inline-rule { background-color: ${value}; }`)
        break
      case 'sourceBackground': rules.push(`:root .source-code, :root .source-code .CodeMirror { background: ${value}; }`); break
      case 'sourceText': rules.push(`:root .source-code .CodeMirror[class] { color: ${value}; }`); break
      case 'h2Decoration': {
        const paint = value === 'tint' ? 'color-mix(in srgb, var(--themeColor) 15%, var(--editorBgColor))' : 'transparent'
        const border = value === 'bar' ? '4px solid var(--themeColor)' : '0'
        rules.push(`${prose} h2:is(.mu-atx-heading,.mu-setext-heading) { background: ${paint}; border-inline-start: ${border}; padding-inline-start: .45em; color: var(--h2-color, var(--editorColor)); box-shadow: none; text-shadow: none; }`)
        break
      }
      default:
        variables(value, key + 'Color', key + '-color')
        rules.push(`${prose} ${key}:is(.mu-atx-heading,.mu-setext-heading) { color: ${value}; }`)
    }
  }
  return rules.join('\n')
}
