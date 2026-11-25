import type { ProjectRootsSnapshot, ProjectTreeEvent, SidebarMoveRequest, SidebarMoveResult } from './project'
import type { MarkdownEdit } from '../markdownEdits'
import type { AiConnectionDraft, AiModelDraft, AiModelProfile } from '../aiModel'
import type { LocalTheme, PreparedPreview, ThemeGenerationResult, ThemeModelEvent, ThemeModelRequest } from '../localTheme'
import type { ThemeCatalogSnapshot } from '../themeCatalog'
import type { ThemeCollaborationCapture, ThemeCollaborationConnection, ThemeCollaborationFiles, ThemeCollaborationState } from '../themeCollaboration'
import type { UserPreferences } from './preferences'
/**
 * Cross-process IPC contract: invoke returns a Promise, send is fire-and-forget,
 * sync returns directly, and main events push payloads to renderer listeners.
 */

import type { IKeyboardLayoutInfo, IKeyboardMapping } from 'native-keymap'
import type { TabOptions, SidebarOpenOptions, PageOptions, ExportType, SerializedStat, LineEnding, FileChangeDetail, PandocExportPayload } from './files'
import type { MenuTemplate, MenuPopupPosition, ContextMenuPopupOptions, ApplicationMenuCategory } from './menu'
import type { PandocCommandInfo } from './pandoc'

export interface SaveDialogRequest {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface ClipboardImageWriteOptions {
  ticket: number
  mime?: 'image/png' | 'image/jpeg'
  text?: string
  html?: string
}

export type ClipboardImageInput = string | { mime: string; data: Uint8Array } | null

export type PlantumlFetchResult =
  { ok: true; mime: string; data: Uint8Array } | { ok: false; error: string }

export type RemoteContentKind = 'about'

export interface RemoteContent {
  markdown: string
}

export interface RemoteContentSnapshot {
  content: RemoteContent | null
  status: 'ready' | 'failed'
}

export interface UpdateProgress {
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateState =
  | { phase: 'idle' | 'checking' | 'current' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; progress: UpdateProgress | null }
  | { phase: 'ready' | 'installing'; version: string }
  | { phase: 'error'; stage: 'check' | 'download' | 'install'; version?: string }

export interface RecentDocument {
  pathname: string
  isDirectory: boolean
}

export type SaveDocumentResult =
  | { status: 'saved'; pathname: string; filename: string; savedMarkdown: string }
  | { status: 'canceled' | 'failed' }

import type { StateIpcInvokeChannels, StateIpcMainEvents } from './applicationState'

export interface IpcInvokeChannels extends StateIpcInvokeChannels {
  'mt::theme::open': { args: [id: string, editing: boolean]; ret: void }
  'mt::theme::catalog': { args: [refresh: boolean]; ret: ThemeCatalogSnapshot }
  'mt::theme::preview': { args: [id: string, revision: number]; ret: LocalTheme }
  'mt::theme::install': { args: [id: string, revision: number, apply: boolean]; ret: UserPreferences | null }
  'mt::theme::save': { args: [theme: LocalTheme, apply: boolean]; ret: LocalTheme | null }
  'mt::theme::delete': { args: [id: string]; ret: UserPreferences | null }
  'mt::theme::inspector-state': { args: []; ret: boolean }
  'mt::theme::set-inspector': { args: [open: boolean]; ret: void }
  'mt::theme::inspect-element': { args: [x: number, y: number]; ret: void }
  'mt::theme::collaboration-install': { args: []; ret: 'installed' | 'conflict' }
  'mt::theme::collaboration-start': { args: [draftId: string, files: ThemeCollaborationFiles, baseCss: string]; ret: ThemeCollaborationConnection }
  'mt::theme::collaboration-write': { args: [id: string, revision: number, files: ThemeCollaborationFiles, baseCss: string]; ret: { saved: boolean; state: ThemeCollaborationState } }
  'mt::theme::collaboration-stop': { args: [id: string]; ret: void }
  'mt::ai::list': { args: []; ret: AiModelProfile[] }
  'mt::ai::save': { args: [draft: AiModelDraft]; ret: AiModelProfile[] }
  'mt::ai::delete': { args: [id: string]; ret: AiModelProfile[] }
  'mt::ai::discover': { args: [draft: AiConnectionDraft]; ret: string[] }
  'mt::ai::test': { args: [draft: AiModelDraft | string]; ret: void }
  // Renderer hot reload can leave the earlier main handler running. Its string result is the final CSS.
  'mt::theme::generate': { args: [request: ThemeModelRequest]; ret: ThemeGenerationResult | string }
  'mt::theme::generate-with-tools': { args: [request: ThemeModelRequest]; ret: ThemeGenerationResult }
  'mt::theme::cancel': { args: [id: string]; ret: void }
  'mt::menu::application-categories': { args: []; ret: ApplicationMenuCategory[] }
  'mt::menu::popup-application-category': {
    args: [index: number, position: MenuPopupPosition]
    ret: void
  }
  'mt::get-recently-used-documents': { args: []; ret: RecentDocument[] }
  'mt::read-heading-link-document': { args: [pathname: string, guessEncoding: boolean]; ret: string | null }
  'mt::media::read-document': { args: [pathname: string, guessEncoding: boolean]; ret: { markdown: string; hash: string } }
  'mt::media::list-documents': { args: [target: string, directory: boolean, excludes: string[], openPaths: string[]]; ret: { files: string[][]; issues: string[] } }
  'mt::media::update-document': { args: [pathname: string, guessEncoding: boolean, hash: string, edits: MarkdownEdit[]]; ret: 'saved' | 'changed' }
  'mt::project-remove-root': { args: [key: string]; ret: boolean }
  'mt::project-retry-root': { args: [key: string]; ret: boolean }
  'mt::project-open-containing-folder': { args: [documentId: string]; ret: string | null }
  'mt::clipboard::write-text': { args: [text: string]; ret: boolean }
  'mt::set-document-read-only': { args: [tabId: string, readOnly: boolean]; ret: void }
  'mt::ask-for-image-path': { args: [kind?: 'video']; ret: string }
  'mt::video::download': { args: [url: string]; ret: { mime: string; data: Uint8Array } }
  'mt::video::embed-file': { args: [pathname: string]; ret: string }
  'mt::video::copy-file': { args: [src: string, name: string]; ret: void }
  'mt::boot-info-async': { args: []; ret: BootInfo }
  'mt::clipboard::guess-file-path': { args: []; ret: string | null }
  'mt::clipboard::read-text': { args: []; ret: string }
  'mt::link::fetch-html': { args: [url: string]; ret: string }
  'mt::remote-content::fetch': {
    args: [kind: RemoteContentKind, refresh: boolean]
    ret: RemoteContentSnapshot
  }
  'mt::clipboard::write-image': {
    args: [bytes: Uint8Array, options?: ClipboardImageWriteOptions]
    ret: boolean
  }
  'mt::clipboard::begin-image-copy': { args: [marker?: string]; ret: number | null }
  'mt::clipboard::cancel-image-copy': { args: [ticket: number]; ret: void }
  'mt::clipboard::read-image-source': { args: [src: string]; ret: PlantumlFetchResult }
  'mt::clipboard::has-image': { args: [kind?: 'video']; ret: boolean }
  'mt::clipboard::image-input': { args: [kind?: 'video']; ret: ClipboardImageInput }
  'mt::embedded-image::drag': { args: [src: string, name: string]; ret: void }
  'mt::cmd::exists': { args: [name: string]; ret: boolean }
  'mt::diagram::fetch-plantuml': {
    args: [server: string, encoded: string, format: 'svg' | 'png']
    ret: PlantumlFetchResult
  }
  'mt::dialog::show-save': { args: [request: SaveDialogRequest]; ret: string | null }
  'mt::fonts::list': { args: []; ret: string[] }
  'mt::fs-trash-item': { args: [pathname: string]; ret: boolean }
  'mt::project-move-item': { args: [request: SidebarMoveRequest]; ret: SidebarMoveResult }
  'mt::fs::copy': { args: [src: string, dest: string]; ret: void }
  'mt::fs::copy-with-content-hash': { args: [src: string, outputDir: string]; ret: string }
  'mt::fs::empty-dir': { args: [path: string]; ret: void }
  'mt::fs::ensure-dir': { args: [path: string]; ret: void }
  'mt::fs::is-directory': { args: [path: string]; ret: boolean }
  'mt::fs::is-executable': { args: [path: string]; ret: boolean }
  'mt::fs::is-file': { args: [path: string]; ret: boolean }
  'mt::fs::move': { args: [src: string, dest: string]; ret: void }
  'mt::fs::output-file': { args: [path: string, data: string | Uint8Array]; ret: void }
  'mt::fs::path-exists': { args: [path: string]; ret: boolean }
  'mt::fs::read-file': { args: [path: string, encoding?: string]; ret: string | Uint8Array }
  'mt::fs::readdir': { args: [path: string]; ret: string[] }
  'mt::fs::stat': { args: [path: string]; ret: SerializedStat }
  'mt::fs::unlink': { args: [path: string]; ret: void }
  'mt::fs::write-file': { args: [path: string, data: string | Uint8Array]; ret: void }
  'mt::i18n::is-supported': { args: [lang: string]; ret: boolean }
  'mt::i18n::load': { args: [language: string]; ret: Record<string, unknown> }
  'mt::i18n::supported': { args: []; ret: string[] }
  'mt::keybinding-get-keyboard-info': { args: []; ret: KeyboardInfo }
  'mt::keybinding-get-pref-keybindings': {
    args: []
    ret: { defaultKeybindings: Map<string, string>; userKeybindings: Map<string, string> }
  }
  'mt::keybinding-save-user-keybindings': { args: [bindings: unknown]; ret: boolean }
  'mt::pandoc::command': { args: []; ret: PandocCommandInfo }
  'mt::paths::is-image': { args: [path: string]; ret: boolean }
  'mt::rg::start': { args: [req: unknown]; ret: { searchId: string } }
  'mt::shell::open-external': { args: [url: string]; ret: void }
  'mt::shell::open-path': { args: [fullPath: string]; ret: string }
  'mt::spellchecker-get-available-dictionaries': { args: []; ret: string[] }
  'mt::spellchecker-get-custom-dictionary-words': { args: []; ret: string[] }
  'mt::spellchecker-remove-word': { args: [word: string]; ret: boolean }
  'mt::spellchecker-set-enabled': { args: [enabled: boolean]; ret: void }
  'mt::spellchecker-switch-language': { args: [language: string]; ret: void }
  'mt::uploader::upload': { args: [req: unknown]; ret: unknown }
  'mt::win::is-cursor-over': {
    args: [bounds: { left: number; top: number; right: number; bottom: number }]
    ret: boolean | null
  }
  'mt::win::is-fullscreen': { args: []; ret: boolean }
  'mt::win::is-maximized': { args: []; ret: boolean }
  // Main derives the BrowserWindow via BrowserWindow.fromWebContents(e.sender);
  // no need to pass windowId. Payload is the editor+project+layout snapshot.
}

export interface IpcSendChannels {
  'mt::cmd-add-folder': []
  'mt::project-renderer-ready': []
  'mt::forget-document': [tabId: string]
  'mt::update-document-mode': [readOnly: boolean, hasDocument?: boolean]
  'app-create-editor-window': [config?: unknown]
  'app-create-settings-window': []
  'app-open-directory-by-id': [windowId: number, dirPath: string]
  'app-open-file-by-id': [windowId: number, filePath: string, options?: unknown]
  'app-open-files-by-id': [windowId: number, filePaths: string[], options?: unknown]
  'app-open-markdown-by-id': [windowId: number, markdown: string, options?: unknown]
  'broadcast-preferences-changed': [partial: unknown]
  'broadcast-user-data-changed': [partial: unknown]
  'menu-add-recently-used': [filePath: string]
  'menu-clear-recently-used': []
  'mt::remove-recently-used-document': [pathname: string]
  'mt::add-recently-used-document': [filePath: string]
  'mt::app-try-quit': []
  'mt::ask-for-image-auto-path': [payload: unknown]
  'mt::ask-for-modify-image-folder-path': [imagePath?: string]
  'mt::ask-for-open-project-in-sidebar': []
  'mt::ask-for-user-data': []
  'mt::ask-for-user-preference': []
  'mt::check-for-update': []
  'mt::update-listen': []
  'mt::update-background': []
  'mt::update-install': [version: string]
  'mt::cancel-pending-preview': [requestId: number]
  'mt::cmd-close-window': []
  'mt::cmd-import-file': []
  'mt::cmd-new-editor-window': []
  'mt::cmd-open-file': []
  'mt::cmd-open-folder': []
  'mt::cmd-toggle-autosave': []
  'mt::editor-selection-changed': [windowId: number, state: unknown]
  'mt::format-link-click': [payload: { data: unknown; dirname: string; readOnly?: boolean }]
  'mt::get-current-language': []
  'mt::handle-renderer-error': [error: unknown]
  'mt::keybinding-debug-dump-keyboard-info': []
  'mt::make-screenshot': []
  'mt::menu::popup': [template: MenuTemplate, options?: ContextMenuPopupOptions]
  'mt::menu::popup-application': [position?: MenuPopupPosition]
  'mt::open-file': [filePath: string, options?: SidebarOpenOptions]
  'mt::open-file-by-window-id': [windowId: number, filePath: string, options?: unknown]
  'mt::open-directory-by-window-id': [windowId: number, dirPath: string]
  'mt::open-keybindings-config': []
  'mt::open-setting-window': [category?: 'ai' | 'theme']
  'mt::prepare-setting-window': []
  'mt::settings-ready': []
  'mt::theme::ready': []
  'mt::theme::preview-painted': [token: string, result: PreparedPreview]
  'mt::rename': [
    payload: { id: string; pathname: string; newPathname: string; currentFile?: unknown }
  ]
  'mt::request-keybindings': []
  'mt::set-editor-format-menus-enabled': [windowId: number, enabled: boolean]
  'mt::response-export': [
    payload: {
      type: ExportType
      title: string
      content: string
      filename: string
      pathname: string
      pageOptions: PageOptions
    }
  ]
  'mt::response-file-move-to': [payload: { id: string; pathname: string }]
  'mt::response-pandoc-export': [payload: PandocExportPayload]
  'mt::response-print': []
  'mt::rg::cancel': [searchId: string]
  'mt::set-user-data': [partial: unknown]
  'mt::set-user-preference': [partial: unknown]
  'mt::shell::open-external': [url: string]
  'mt::shell::show-item': [fullPath: string]
  'mt::update-format-menu': [windowId: number, state: Record<string, boolean>]
  'mt::update-line-ending-menu': [windowId: number, lineEnding: LineEnding]
  'mt::update-sidebar-menu': [windowId: number, visible: boolean]
  'mt::view-layout-changed': [windowId: number, layout: unknown]
  'mt::win::close': []
  'mt::win::maximize': []
  'mt::win::minimize': []
  'mt::win::set-fullscreen': [flag: boolean]
  'mt::win::toggle-fullscreen': []
  'mt::win::toggle-maximize': []
  'mt::win::unmaximize': []
  'mt::window-add-file-path': [windowId: number, filePath: string]
  'mt::window-initialized': []
  'mt::window-tab-closed': [pathname: string]
  'mt::window-toggle-always-on-top': []
  'mt::window::drop': [payload: unknown]
  'screen-capture': [payload: unknown]
  'set-image-folder-path': [path: string]
  'set-user-preference': [partial: unknown]
  'watcher-unwatch-all-by-id': [windowId: number]
  'watcher-unwatch-directory': [windowId: number, path: string]
  'watcher-unwatch-file': [windowId: number, path: string]
  'watcher-watch-directory': [windowId: number, path: string]
  'watcher-watch-file': [windowId: number, path: string]
  'window-add-file-path': [windowId: number, filePath: string]
  'window-change-file-path': [windowId: number, oldPath: string, newPath: string]
  'window-close-by-id': [windowId: number]
  'window-file-saved': [windowId: number, tabId: string]
  'window-reload-by-id': [windowId: number]
  'window-toggle-always-on-top': [windowId: number]
}

export interface IpcSyncChannels {
  'mt::boot-info': { args: []; ret: BootInfo }
  'mt::paths::is-same-sync': { args: [a: string, b: string]; ret: boolean }
}

export interface IpcMainEventChannels extends StateIpcMainEvents {
  'mt::ai::changed': [profiles: AiModelProfile[]]
  'mt::theme::show': [id: string, editing: boolean]
  'mt::theme::progress': [id: string, change: ThemeModelEvent]
  'mt::theme::inspector-changed': [open: boolean]
  'mt::theme::collaboration-state': [id: string, state: ThemeCollaborationState]
  'mt::theme::collaboration-capture': [id: string, event: ThemeCollaborationCapture]
  'mt::menu::application-categories-changed': []
  'mt::toggle-read-only': []
  'language-changed': [language: string]
  'mt::update-state': [state: UpdateState, showDialog?: boolean]
  'mt::about-dialog': []
  'mt::cm-copy-as-html': []
  'mt::cm-copy-as-rich': []
  'mt::cm-insert-paragraph': [direction: 'before' | 'after']
  'mt::cm-paste-as-plain-text': []
  'mt::current-language': [language: string]
  'mt::editor-ask-file-save': []
  'mt::editor-ask-file-save-as': []
  'mt::editor-close-tab': [tabId?: string]
  'mt::editor-edit-action': [action: string]
  'mt::editor-format-action': [payload: { type: string }]
  'mt::editor-move-file': []
  'mt::editor-paragraph-action': [payload: { type: string }]
  'mt::editor-rename-file': []
  'mt::execute-command-by-id': [commandId: string]
  'mt::export-success': [payload: { type: string; filePath: string; linksMedia?: boolean }]
  'mt::export-with-pandoc': [target: string]
  'mt::invalidate-image-cache': []
  'mt::keybindings-response': [bindings: Readonly<Record<string, string>>]
  'mt::menu::click': [menuId: string]
  'mt::menu::closed': []
  'mt::new-untitled-tab': [selected?: boolean, markdown?: string]
  'mt::project-roots-changed': [snapshot: ProjectRootsSnapshot]
  'mt::pandoc-not-exists': [opts: Record<string, unknown>]
  'mt::print-service-clearup': []
  'mt::rg::cancelled': [payload: unknown]
  'mt::rg::done': [payload: unknown]
  'mt::rg::error': [payload: unknown]
  'mt::rg::match': [payload: unknown]
  'mt::rg::progress': [payload: unknown]
  'mt::screenshot-captured': [filePath: string]
  'mt::set-line-ending': [lineEnding: LineEnding]
  'mt::set-view-layout': [layout: unknown]
  'mt::show-command-palette': []
  'mt::show-export-dialog': [type: ExportType]
  'mt::show-notification': [payload: unknown]
  'mt::spelling-replace-misspelling': [payload: unknown]
  'mt::spelling-show-switch-language': []
  'mt::switch-tab-by-file_path': [filePath: string, options?: TabOptions]
  'mt::switch-tab-by-index': [index: number]
  'mt::tab-save-failure': [tabId: string, message: string]
  'mt::tabs-cycle-left': []
  'mt::tabs-cycle-right': []
  'mt::toggle-view-layout-entry': [entry: string]
  'mt::toggle-view-mode-entry': [entry: string]
  'mt::update-file': [payload: { type: 'add' | 'change' | 'unlink'; change: FileChangeDetail }]
  'mt::update-object-tree': [payload: ProjectTreeEvent]
  'mt::user-preference': [partial: unknown]
  'mt::window-active-status': [state: { status: boolean }]
  'mt::window-enter-full-screen': []
  'mt::window-leave-full-screen': []
  'mt::window-maximize': []
  'mt::window-unmaximize': []
  'mt::window-zoom': [zoomLevel: number]
  'settings::change-tab': [tab: string]
}

/**
 * Snapshot of the active OS keyboard layout, returned by
 * `mt::keybinding-get-keyboard-info`. Mirrors the runtime shape produced
 * by `native-keymap` (see `src/main/keyboard/index.ts#getKeyboardInfo`).
 */
export interface KeyboardInfo {
  layout: IKeyboardLayoutInfo
  keymap: IKeyboardMapping
}

export interface BootInfo {
  platform: NodeJS.Platform
  arch: string
  versions: Record<string, string>
  env: Record<string, string>
  paths: {
    resources: string
    userData: string
    cwd: string
    ripgrepBinary: string
  }
  isUpdatable: boolean
  MARKDOWN_INCLUSIONS: string[]
}
