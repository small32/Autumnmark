import type { UserPreferences } from '@shared/types/preferences'
import type { LocalTheme } from '@shared/localTheme'
import { defineStore } from 'pinia'
import { setLanguage } from '../i18n'
import {
  renameHiddenSidebarPaths,
  sameHiddenSidebarPaths,
  withHiddenSidebarPath,
  withoutHiddenSidebarPath,
  withoutHiddenSidebarSubtree
} from '../util/hiddenSidebarFiles'

// Serialize hidden-sidebar mutations so that rapid or overlapping hide/restore
// calls always compute from the latest state. Without this queue, two actions
// can both read the same stale `hiddenSidebarPaths` snapshot before their IPC
// writes settle, and the later write silently drops the earlier one.
let hiddenSidebarMutation: Promise<unknown> = Promise.resolve()

const enqueueHiddenSidebarMutation = (task: () => Promise<boolean>): Promise<boolean> => {
  const result = hiddenSidebarMutation.then(task, task)
  hiddenSidebarMutation = result.catch(() => undefined)
  return result
}

export type EndOfLine = 'default' | 'lf' | 'crlf'
export type TitleBarStyle = 'custom' | 'native'
export type TextDirection = 'ltr' | 'rtl'
export type BulletListMarker = '*' | '+' | '-'
export type OrderListDelimiter = '.' | ')'
export type PreferHeadingStyle = 'atx' | 'setext'
export type FrontmatterType = '-' | ';' | '{' | '+'
export type SequenceTheme = 'hand' | 'simple'
export type ImageInsertAction = 'folder' | 'path' | 'upload' | 'embed'
export type ImageRelativeDirectoryBase = 'file' | 'folder'
export type FileSortBy = 'created' | 'modified' | 'title'
export type FileSortOrder = 'asc' | 'desc'

export interface PreferencesState {
  autoSave: boolean
  autoSaveDelay: number
  titleBarStyle: TitleBarStyle | string
  openFilesInNewWindow: boolean
  openFolderInNewWindow: boolean
  zoom: number
  hideScrollbar: boolean
  wordWrapInToc: boolean
  tocPosition: 'left' | 'right'
  fileSortBy: FileSortBy | string
  fileSortOrder: FileSortOrder | string
  defaultOpenMode: 'edit' | 'read'
  startUpAction: UserPreferences['startUpAction']
  restoreLayoutState: boolean
  restoreEditors: boolean
  restoreViewState: boolean
  defaultDirectoryToOpen: string
  treePathExcludePatterns: string[]
  hiddenSidebarPaths: string[]
  checkUpdatesOnStartup: boolean
  onlineUpdateEnabled: boolean
  language: string
  showPandocConvert: boolean

  editorFontFamily: string
  fontSize: number
  lineHeight: number
  codeFontSize: number
  codeFontFamily: string
  codeBlockLineNumbers: boolean
  sourceCodeLineNumbers: boolean
  trimUnnecessaryCodeBlockEmptyLines: boolean
  compactMode: boolean
  compactImageMaxHeight: number
  compactVideoMaxHeight: number
  compactCodeMaxLines: number
  wrapCodeBlocks: boolean
  editorLineWidth: string

  autoPairBracket: boolean
  autoPairMarkdownSyntax: boolean
  autoPairQuote: boolean
  endOfLine: EndOfLine | string
  defaultEncoding: string
  autoGuessEncoding: boolean
  autoNormalizeLineEndings: boolean

  trimTrailingNewline: number
  textDirection: TextDirection | string
  hideQuickInsertHint: boolean
  imageInsertAction: ImageInsertAction | string
  embedVideos: boolean
  imagePreferRelativeDirectory: boolean
  imageRelativeDirectoryBase: ImageRelativeDirectoryBase | string
  imageRelativeDirectoryName: string
  hideLinkPopup: boolean
  autoCheck: boolean

  preferLooseListItem: boolean
  bulletListMarker: BulletListMarker | string
  orderListDelimiter: OrderListDelimiter | string
  preferHeadingStyle: PreferHeadingStyle | string
  tabSize: number | 'tab'
  listIndentation: number
  frontmatterType: FrontmatterType | string
  cjkEmphasis: boolean
  superSubScript: boolean
  footnote: boolean
  texMathDollars: boolean
  texMathGfm: boolean
  texMathSingleBackslash: boolean
  texMathDoubleBackslash: boolean
  fancyLists: boolean
  highlightSyntax: boolean
  inlineDiff: boolean
  multilineBlockquote: boolean
  githubAlerts: boolean
  isHtmlEnabled: boolean
  softNewlineAsSpace: boolean
  sequenceTheme: SequenceTheme | string
  mermaidLightTheme: string
  mermaidDarkTheme: string
  plantumlServer: string

  localThemes: LocalTheme[]
  theme: string
  followSystemTheme: boolean
  lightModeTheme: string
  darkModeTheme: string
  customCss: string

  spellcheckerEnabled: boolean
  spellcheckerNoUnderline: boolean
  spellcheckerLanguage: string

  sourceCodeModeEnabled: boolean
  openedFilesInSidebar: boolean
  autoRevealInSidebar: boolean
  openFilesInPreviewMode: boolean

  searchExclusions: string[]
  searchMaxFileSize: string
  searchIncludeHidden: boolean
  searchNoIgnore: boolean
  searchFollowSymlinks: boolean

  watcherUsePolling: boolean

  typewriter: boolean
  focus: boolean
  sourceCode: boolean

  imageFolderPath: string
  webImages: unknown[]
  cloudImages: unknown[]
  currentUploader: string
  cliScript: string
  /** Keys received through a live broadcast; a fetched snapshot must not override them. */
  broadcastedPreferenceKeys: string[]
}

interface SingleSetPreferencePayload {
  type: keyof PreferencesState | string
  value: unknown
}

interface SetUserDataPayload {
  type: string
  value: unknown
}

interface ModeTogglePayload {
  type: keyof PreferencesState | 'typewriter' | 'focus' | 'sourceCode'
  checked: boolean
}

export const usePreferencesStore = defineStore('preferences', {
  state: (): PreferencesState => ({
    autoSave: false,
    autoSaveDelay: 5000,
    titleBarStyle: 'custom',
    openFilesInNewWindow: false,
    openFolderInNewWindow: false,
    zoom: 1.0,
    hideScrollbar: false,
    wordWrapInToc: false,
    tocPosition: 'left',
    fileSortBy: 'created',
    fileSortOrder: 'asc',
    defaultOpenMode: 'edit',
    startUpAction: 'restoreAll',
    restoreLayoutState: true,
    restoreEditors: true,
    restoreViewState: true,
    defaultDirectoryToOpen: '',
    treePathExcludePatterns: [],
    hiddenSidebarPaths: [],
    checkUpdatesOnStartup: true,
    onlineUpdateEnabled: true,
    language: 'en',
    showPandocConvert: false,

    editorFontFamily: 'Open Sans',
    fontSize: 16,
    lineHeight: 1.6,
    codeFontSize: 14,
    codeFontFamily: 'DejaVu Sans Mono',
    codeBlockLineNumbers: false,
    sourceCodeLineNumbers: true,
    trimUnnecessaryCodeBlockEmptyLines: true,
    compactMode: true,
    compactImageMaxHeight: 0,
    compactVideoMaxHeight: 0,
    compactCodeMaxLines: 12,
    wrapCodeBlocks: true,
    editorLineWidth: '',

    autoPairBracket: true,
    autoPairMarkdownSyntax: true,
    autoPairQuote: true,
    endOfLine: 'default',
    defaultEncoding: 'utf8',
    autoGuessEncoding: true,
    autoNormalizeLineEndings: false,

    trimTrailingNewline: 2,
    textDirection: 'ltr',
    hideQuickInsertHint: false,
    imageInsertAction: 'embed',
    embedVideos: false,
    imagePreferRelativeDirectory: false,
    imageRelativeDirectoryBase: 'file',
    imageRelativeDirectoryName: 'assets',
    hideLinkPopup: false,
    autoCheck: false,

    preferLooseListItem: true,
    bulletListMarker: '-',
    orderListDelimiter: '.',
    preferHeadingStyle: 'atx',
    tabSize: 4,
    listIndentation: 1,
    frontmatterType: '-',
    cjkEmphasis: true,
    superSubScript: false,
    footnote: false,
    texMathDollars: true,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    fancyLists: false,
    highlightSyntax: false,
    inlineDiff: false,
    multilineBlockquote: false,
    githubAlerts: false,
    isHtmlEnabled: true,
    softNewlineAsSpace: false,
    sequenceTheme: 'hand',
    mermaidLightTheme: 'default',
    mermaidDarkTheme: 'dark',
    plantumlServer: 'https://www.plantuml.com/plantuml',

    localThemes: [],
    theme: 'light',
    followSystemTheme: true,
    lightModeTheme: 'light',
    darkModeTheme: 'dark',
    customCss: '',

    spellcheckerEnabled: false,
    spellcheckerNoUnderline: false,
    spellcheckerLanguage: 'en-US',

    sourceCodeModeEnabled: false,
    openedFilesInSidebar: true,
    autoRevealInSidebar: true,
    openFilesInPreviewMode: true,

    searchExclusions: [],
    searchMaxFileSize: '',
    searchIncludeHidden: false,
    searchNoIgnore: false,
    searchFollowSymlinks: true,

    watcherUsePolling: false,

    // Edit modes of the current window (not part of persistent settings)
    typewriter: false, // typewriter mode
    focus: false,
    sourceCode: false, // source code mode

    imageFolderPath: '',
    webImages: [],
    cloudImages: [],
    currentUploader: 'picgo',
    cliScript: '',

    // Keys that arrived through a live broadcast after this window started.
    // A fetched snapshot must not overwrite them (the broadcast is newer).
    broadcastedPreferenceKeys: [] as string[]
  }),

  getters: {
    getAll: (state): PreferencesState => state
  },

  actions: {
    SET_USER_PREFERENCE(preference: Partial<PreferencesState> | Record<string, unknown>, options?: { skipBroadcasted?: boolean }): void | Promise<void> {
      const skip = options?.skipBroadcasted ? new Set(this.broadcastedPreferenceKeys) : null
      Object.keys(preference).forEach((key) => {
        // A live broadcast is newer than a fetched snapshot; keep the broadcast.
        if (skip?.has(key)) return
        const incoming = (preference as Record<string, unknown>)[key]
        if (
          typeof incoming !== 'undefined' &&
          typeof (this as unknown as Record<string, unknown>)[key] !== 'undefined'
        ) {
          ;(this as unknown as Record<string, unknown>)[key] = incoming
        }
      })

      const lang = (preference as { language?: string }).language
      if (typeof lang === 'string' && !skip?.has('language')) {
        return setLanguage(lang)
      }
    },

    SET_MODE({ type, checked }: ModeTogglePayload): void {
      ;(this as unknown as Record<string, unknown>)[type as string] = checked
    },

    LISTEN_FOR_USER_PREFERENCE(): void {
      window.electron.ipcRenderer.on('mt::user-preference', (_e, preferences) => {
        const keys = preferences && typeof preferences === 'object' ? Object.keys(preferences) : []
        if (keys.length) {
          this.broadcastedPreferenceKeys = [...new Set([...this.broadcastedPreferenceKeys, ...keys])]
        }
        this.SET_USER_PREFERENCE(preferences as Partial<PreferencesState>)
      })
    },

    ASK_FOR_USER_PREFERENCE(): void {
      this.LISTEN_FOR_USER_PREFERENCE()
      window.electron.ipcRenderer.send('mt::ask-for-user-preference')
      window.electron.ipcRenderer.send('mt::ask-for-user-data')
    },

    SET_SINGLE_PREFERENCE({ type, value }: SingleSetPreferencePayload): void {
      ;(this as unknown as Record<string, unknown>)[type as string] = value

      if (type === 'language' && typeof value === 'string') {
        setLanguage(value)
      }

      window.electron.ipcRenderer.send('mt::set-user-preference', { [type as string]: value })
    },

    async SET_HIDDEN_SIDEBAR_PATHS(pathnames: string[]): Promise<boolean> {
      const result = await window.electron.ipcRenderer.invoke('mt::preferences::update', {
        hiddenSidebarPaths: pathnames
      }) as { status?: string } | undefined
      if (result?.status !== 'persisted') return false
      this.hiddenSidebarPaths = pathnames
      return true
    },

    async HIDE_SIDEBAR_ITEM(pathname: string): Promise<boolean> {
      // Compute from the freshest state inside the queue, not before it.
      return enqueueHiddenSidebarMutation(() =>
        this.SET_HIDDEN_SIDEBAR_PATHS(withHiddenSidebarPath(this.hiddenSidebarPaths, pathname))
      )
    },

    async RESTORE_SIDEBAR_ITEM(pathname: string): Promise<boolean> {
      return enqueueHiddenSidebarMutation(() =>
        this.SET_HIDDEN_SIDEBAR_PATHS(withoutHiddenSidebarPath(this.hiddenSidebarPaths, pathname))
      )
    },

    async RESTORE_ALL_SIDEBAR_ITEMS(): Promise<boolean> {
      return enqueueHiddenSidebarMutation(() => this.SET_HIDDEN_SIDEBAR_PATHS([]))
    },

    // Hide several items in one IPC write so a multi-selection is atomic.
    async HIDE_SIDEBAR_ITEMS(pathnames: string[]): Promise<boolean> {
      return enqueueHiddenSidebarMutation(() => {
        const next = pathnames.reduce(
          (current, pathname) => withHiddenSidebarPath(current, pathname),
          this.hiddenSidebarPaths
        )
        if (sameHiddenSidebarPaths(next, this.hiddenSidebarPaths)) return Promise.resolve(true)
        return this.SET_HIDDEN_SIDEBAR_PATHS(next)
      })
    },

    // Called after a successful rename/move so a hidden item keeps its hidden
    // state under the new path instead of reappearing with a stale entry left behind.
    async RENAME_HIDDEN_SIDEBAR_ITEM(src: string, dest: string): Promise<boolean> {
      return enqueueHiddenSidebarMutation(() => {
        const next = renameHiddenSidebarPaths(this.hiddenSidebarPaths, src, dest)
        if (sameHiddenSidebarPaths(next, this.hiddenSidebarPaths)) return Promise.resolve(true)
        return this.SET_HIDDEN_SIDEBAR_PATHS(next)
      })
    },

    // Called after an item is trashed to drop its (and its descendants') hidden entries.
    async REMOVE_HIDDEN_SIDEBAR_ITEM(pathname: string): Promise<boolean> {
      return enqueueHiddenSidebarMutation(() => {
        const next = withoutHiddenSidebarSubtree(this.hiddenSidebarPaths, pathname)
        if (next.length === this.hiddenSidebarPaths.length) return Promise.resolve(true)
        return this.SET_HIDDEN_SIDEBAR_PATHS(next)
      })
    },

    SET_USER_DATA({ type, value }: SetUserDataPayload): void {
      window.electron.ipcRenderer.send('mt::set-user-data', { [type]: value })
    },

    SET_IMAGE_FOLDER_PATH(value?: string): void {
      window.electron.ipcRenderer.send('mt::ask-for-modify-image-folder-path', value)
    },

    DISPATCH_EDITOR_VIEW_STATE(viewState: Record<string, unknown>): void {
      const { windowId } = window.marktext?.env ?? { windowId: -1 }
      window.electron.ipcRenderer.send('mt::view-layout-changed', windowId, viewState)
    }
  }
})
