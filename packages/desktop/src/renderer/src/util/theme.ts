import {
  THEME_STYLE_ID,
  COMMON_STYLE_ID,
  DEFAULT_CODE_FONT_FAMILY,
  oneDarkThemes,
  railscastsThemes
} from '../config'
import { builtinThemeCss } from './builtinTheme'

import { themeBaseId } from 'common/theme'
import { localThemeList, type LocalTheme } from '@shared/localTheme'
import { localThemeCss } from './themeOverrides'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ORIGINAL_THEME = '#409EFF'

const patchTheme = (css: string): string => {
  return `@media not print {\n${css}\n}`
}

export const addThemeStyle = (id: string, library?: LocalTheme[]): void => {
  const theme = themeBaseId(id)
  const custom = localThemeList(library).find(item => item.id === id)
  const isCmRailscasts = railscastsThemes.includes(theme)
  const isCmOneDark = oneDarkThemes.includes(theme)
  const isDarkTheme = isCmOneDark || isCmRailscasts
  let themeStyleEle = document.querySelector(`#${THEME_STYLE_ID}`) as HTMLStyleElement | null
  if (!themeStyleEle) {
    themeStyleEle = document.createElement('style')
    themeStyleEle.id = THEME_STYLE_ID
    document.head.appendChild(themeStyleEle)
  }

  themeStyleEle.textContent = patchTheme(builtinThemeCss(theme) + '\n' + localThemeCss(custom))

  // workaround: use dark icons
  document.body.classList.remove('dark')
  if (isDarkTheme) {
    document.body.classList.add('dark')
  }

  const cm = document.querySelector('.CodeMirror')
  if (cm) {
    cm.classList.remove('cm-s-default')
    cm.classList.remove('cm-s-one-dark')
    cm.classList.remove('cm-s-railscasts')
    if (isCmOneDark) {
      cm.classList.add('cm-s-one-dark')
    } else if (isCmRailscasts) {
      cm.classList.add('cm-s-railscasts')
    } else {
      cm.classList.add('cm-s-default')
    }
  }
}

export const setEditorWidth = (value: string): void => {
  const EDITOR_WIDTH_STYLE_ID = 'editor-width'
  let result = ''
  if (value && /^[0-9]+(?:ch|px|%)$/.test(value)) {
    // Include 100px horizontal padding; both editor modes consume distinct width variables.
    const width = `calc(100px + ${value})`
    result = `:root { --editorAreaWidth: ${width}; --editor-area-width: ${width}; }`
  }
  let styleEle = document.querySelector(`#${EDITOR_WIDTH_STYLE_ID}`) as HTMLStyleElement | null
  if (!styleEle) {
    styleEle = document.createElement('style')
    styleEle.setAttribute('id', EDITOR_WIDTH_STYLE_ID)
    document.head.appendChild(styleEle)
  }

  styleEle.innerHTML = result
}

export interface CommonStyleOptions {
  codeFontFamily: string
  codeFontSize: number | string
  hideScrollbar?: boolean
  [key: string]: unknown
}

export const addCommonStyle = (options: CommonStyleOptions): void => {
  const { codeFontFamily, codeFontSize, hideScrollbar } = options
  const resolvedCodeFont = codeFontFamily ? `${codeFontFamily}, ${DEFAULT_CODE_FONT_FAMILY}` : DEFAULT_CODE_FONT_FAMILY
  let sheet = document.querySelector(`#${COMMON_STYLE_ID}`) as HTMLStyleElement | null
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = COMMON_STYLE_ID
    document.head.appendChild(sheet)
  }

  let scrollbarStyle = ''
  if (hideScrollbar) {
    scrollbarStyle = '::-webkit-scrollbar {display: none;}'
  }

  sheet.innerHTML = `${scrollbarStyle}
.CodeMirror {
font-family: ${resolvedCodeFont};
font-size: ${codeFontSize}px;
}
`
}

export interface CustomStyleOptions {
  customCss?: string
  [key: string]: unknown
}

export const addCustomStyle = (options: CustomStyleOptions): void => {
  const { customCss } = options
  if (!customCss) {
    document.querySelector('#custom-styles')?.remove()
    return
  }

  let customStyleEle = document.querySelector('#custom-styles') as HTMLStyleElement | null
  if (!customStyleEle) {
    customStyleEle = document.createElement('style')
    customStyleEle.id = 'custom-styles'
    document.head.appendChild(customStyleEle)
  }
  customStyleEle.innerHTML = customCss
}

export interface AddStylesOptions extends CommonStyleOptions {
  localThemes?: LocalTheme[]
  theme: string
}

// Append common sheet and theme at the end of head - order is important.
export const addStyles = (options: AddStylesOptions): void => {
  const { theme } = options
  addThemeStyle(theme, options.localThemes)
  addCommonStyle(options)
}
