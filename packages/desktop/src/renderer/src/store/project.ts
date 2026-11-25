import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  addFile,
  unlinkFile,
  addDirectory,
  unlinkDirectory,
  resortTree,
  updateFileMtime,
  expandAncestors,
  findTreeNode
} from './treeCtrl'
import { usePreferencesStore } from './preferences'
import bus from '../bus'
import { create, paste, rename, type FileCreateType, type PasteOptions } from '../util/fileSystem'
import { PATH_SEPARATOR } from '../config'
import notice from '../services/notification'
import { useLayoutStore } from './layout'
import { useEditorStore } from './editor'
import { scheduleWindowCheckpoint } from './checkpoint'
import { normalizeHiddenSidebarPath } from '../util/hiddenSidebarFiles'
import type { TreeNode, TreeFolderNode } from '../components/sideBar/types'
import type { FileChangeDetail } from '@shared/types/files'
import {
  STATE_LIMITS,
  type ProjectViewState,
  type WorkspaceDescriptor
} from '@shared/types/applicationState'
import {
  type ProjectRoot,
  type ProjectRootsSnapshot
} from '@shared/types/project'
import { t } from '../i18n'

type ProjectTree = TreeNode
type TreeChange = FileChangeDetail

const normalizeProjectRoot = (pathname: string | null | undefined): string => {
  return pathname ? window.path.normalize(pathname) : ''
}

const createProjectRoot = (pathname: string): ProjectTree | null => {
  const normalizedPathname = normalizeProjectRoot(pathname)
  if (!normalizedPathname) return null

  let name = window.path.basename(normalizedPathname)
  if (!name) {
    name = normalizedPathname
  }

  return {
    pathname: normalizedPathname,
    name,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }
}

export interface RootView extends ProjectRoot {
  tree: ProjectTree
  collapsedPaths: Set<string>
  restoring: boolean
}

const isWithinRoot = (root: string, pathname: string): boolean => {
  const relative = window.path.relative(root, pathname)
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${PATH_SEPARATOR}`) &&
      !window.path.isAbsolute(relative))
  )
}

const visitFolders = (tree: TreeFolderNode, visit: (folder: TreeFolderNode) => void): void => {
  visit(tree)
  for (const folder of tree.folders) visitFolders(folder, visit)
}

interface CreateCacheEntry {
  dirname: string
  type: 'file' | 'directory' | string
}

interface ClipboardEntry {
  type: 'copy' | 'cut' | string
  src: string
  dest?: string
}

export const useProjectStore = defineStore('project', () => {
  // Heterogeneous UI state: assigned file nodes, folder nodes, and the empty
  // "no selection" object/null across sidebar components; a single non-`any`
  // union breaks both the assignments and the field reads, so it stays a hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeItem = ref<any>({})
  // Ctrl/Cmd+click multi-selection. Stores pathnames (not nodes) so the
  // selection survives tree rebuilds; the last clicked item stays `activeItem`.
  const selectedPaths = ref<string[]>([])
  const createCache = ref<CreateCacheEntry | Record<string, never>>({})
  const newFileNameCache = ref<string>('')
  const renameCache = ref<string | null>(null)
  // Text of whichever inline rename/create input is open. It lives here (not in
  // the row components) so the click-away handler can commit the edit.
  const nameInputValue = ref<string>('')
  const clipboard = ref<ClipboardEntry | null>(null)
  const restoringSession = ref(false)
  const roots = ref<RootView[]>([])
  const availableRoots = computed(() => roots.value.filter((root) => root.status === 'ready'))
  const projectTree = computed<ProjectTree | null>(() => {
    const currentFile = useEditorStore().currentFile
    if (currentFile)
      return currentFile.pathname ? (FIND_ROOT(currentFile.pathname)?.tree ?? null) : null
    return roots.value.length === 1 ? roots.value[0].tree : null
  })
  let revision = 0
  const treeVersion = ref(0)
  const movingSource = ref<string | null>(null)

  const preferencesStore = usePreferencesStore()

  watch(
    [() => preferencesStore.fileSortBy, () => preferencesStore.fileSortOrder],
    ([sortBy, sortOrder]) => {
      for (const root of roots.value) {
        resortTree(root.tree, String(sortBy), String(sortOrder))
      }
    }
  )

  function FIND_ROOT(pathname: string): RootView | undefined {
    return roots.value.find(
      (root) => isWithinRoot(root.pathname, pathname) || isWithinRoot(root.key, pathname)
    )
  }

  function ROOT_BASE(pathname: string): string | undefined {
    const root = FIND_ROOT(pathname)
    return root ? (isWithinRoot(root.pathname, pathname) ? root.pathname : root.key) : undefined
  }

  function TREE_PATH(pathname: string): string {
    const root = FIND_ROOT(pathname)
    const base = ROOT_BASE(pathname)
    return root && base && base !== root.pathname
      ? window.path.join(root.pathname, window.path.relative(base, pathname))
      : pathname
  }

  function FIND_TREE_NODE(pathname: string) {
    const root = FIND_ROOT(pathname)
    return root ? findTreeNode(root.tree, TREE_PATH(pathname)) : undefined
  }

  function GET_DEFAULT_DIRECTORY(): string {
    const selected =
      typeof activeItem.value?.pathname === 'string'
        ? FIND_ROOT(activeItem.value.pathname)
        : undefined
    if (selected?.status === 'ready') return selected.pathname
    return availableRoots.value.length === 1 ? availableRoots.value[0].pathname : ''
  }

  function ROOT_LABEL(root: RootView): string {
    const name = root.tree.name
    return roots.value.filter((item) => item.tree.name === name).length > 1
      ? `${name} — ${window.path.dirname(root.pathname)}`
      : name
  }

  function FILE_LABEL(pathname: string): string {
    const root = FIND_ROOT(pathname)
    const base = ROOT_BASE(pathname)
    return root && base ? `${ROOT_LABEL(root)} / ${window.path.relative(base, pathname)}` : pathname
  }

  function SHOW_FILES(scheduleBufferUpdate = true): void {
    const layoutStore = useLayoutStore()
    layoutStore.SET_LAYOUT({ rightColumn: 'files', showSideBar: true })
    layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
    if (scheduleBufferUpdate) scheduleWindowCheckpoint()
  }

  function APPLY_ROOTS(snapshot: ProjectRootsSnapshot): void {
    if (snapshot.revision <= revision) return
    revision = snapshot.revision
    if (snapshot.reason === 'restore') restoringSession.value = true
    const removedIndex = roots.value.findIndex((root) => root.key === snapshot.targetKey)
    roots.value = snapshot.roots.flatMap((root): RootView[] => {
      const existing = roots.value.find(
        (item) => item.key === root.key && item.watchToken === root.watchToken
      )
      if (existing) {
        Object.assign(existing, root)
        if (root.status === 'ready') existing.restoring = false
        return [existing]
      }
      const previous = roots.value.find((item) => item.key === root.key)
      const collapsedPaths = new Set(previous ? collectCollapsed(previous) : [])
      const tree = createProjectRoot(root.pathname)
      // A root without a usable pathname cannot be watched or rendered.
      if (!tree) return []
      tree.isCollapsed = collapsedPaths.has('')
      return [{ ...root, tree, collapsedPaths, restoring: !!previous }]
    })
    treeVersion.value++
    if (activeItem.value?.pathname && !FIND_ROOT(activeItem.value.pathname)) CLEAR_SELECTION()
    if (snapshot.reason === 'replace' || snapshot.reason === 'remove') CLEAR_NAME_INPUT_STATE()
    if (['add', 'replace', 'reveal'].includes(snapshot.reason)) {
      SHOW_FILES()
      nextTick(() => bus.emit('SIDEBAR::focus-root', snapshot.targetKey))
      if (snapshot.reason === 'reveal')
        notice.notify({
          title: t('menu.file.addFolder'),
          type: 'info',
          message: t('sideBar.tree.folderAlreadyAdded')
        })
    }
    if (snapshot.reason === 'remove') {
      nextTick(() =>
        bus.emit(
          'SIDEBAR::focus-root',
          roots.value[Math.min(Math.max(removedIndex, 0), roots.value.length - 1)]?.key
        )
      )
    }
    if (snapshot.reason !== 'restore') scheduleWindowCheckpoint()
  }

  function collectCollapsed(root: RootView): string[] {
    const paths: string[] = []
    visitFolders(root.tree, (folder) => {
      if (folder.isCollapsed) paths.push(window.path.relative(root.pathname, folder.pathname))
    })
    return root.restoring || root.status === 'unavailable'
      ? [...new Set([...root.collapsedPaths, ...paths])]
      : paths
  }

  const safeCollapsedPaths = (paths: string[]): string[] =>
    [
      ...new Set(
        paths.filter(
          (relative) =>
            typeof relative === 'string' &&
            !/^(?:[A-Za-z]:|[\\/])/.test(relative) &&
            !relative.split(/[\\/]/).includes('..')
        )
      )
    ].slice(0, STATE_LIMITS.collapsedPathsPerRoot)

  const matchesWorkspaceRoot = (root: RootView, descriptor: WorkspaceDescriptor['roots'][number]): boolean =>
    window.path.normalize(root.key) === window.path.normalize(descriptor.location.canonicalPath) ||
    window.path.normalize(root.pathname) === window.path.normalize(descriptor.location.path)

  function CAPTURE_PROJECT_VIEW(workspace: WorkspaceDescriptor | null): ProjectViewState {
    return {
      roots: (workspace?.roots ?? []).map((descriptor) => {
        const root = roots.value.find(root => matchesWorkspaceRoot(root, descriptor))
        return {
          rootId: descriptor.id,
          collapsedPaths: root ? safeCollapsedPaths(collectCollapsed(root)) : []
        }
      })
    }
  }

  function RESTORE_PROJECT_VIEW(
    workspace: WorkspaceDescriptor | null,
    state: ProjectViewState
  ): void {
    restoringSession.value = false
    for (const root of roots.value) {
      const descriptor = workspace?.roots.find(item => matchesWorkspaceRoot(root, item))
      const entry = descriptor
        ? state.roots.find((entry) => entry.rootId === descriptor.id)
        : undefined
      if (!entry) {
        visitFolders(root.tree, folder => { folder.isCollapsed = folder !== root.tree })
        root.collapsedPaths = new Set(collectCollapsed(root))
        root.restoring = false
        continue
      }
      restoringSession.value = true
      root.collapsedPaths = new Set(safeCollapsedPaths(entry.collapsedPaths))
      root.restoring = true
      visitFolders(root.tree, (folder) => {
        folder.isCollapsed = root.collapsedPaths.has(
          window.path.relative(root.pathname, folder.pathname)
        )
      })
    }
    treeVersion.value++
  }

  function LISTEN_FOR_LOAD_PROJECT(): void {
    window.electron.ipcRenderer.on('mt::project-roots-changed', (_e, snapshot) =>
      APPLY_ROOTS(snapshot)
    )
  }

  function LISTEN_FOR_UPDATE_PROJECT(): void {
    window.electron.ipcRenderer.on('mt::update-object-tree', (_e, payload) => {
      const { type, change, rootKey, watchToken } = payload
      const root = roots.value.find(
        (item) => item.key === rootKey && item.watchToken === watchToken
      )
      if (!root || !isWithinRoot(root.pathname, change.pathname)) return
      _processTreeEvent(root, type, change)
    })
  }

  function _processTreeEvent(root: RootView, type: string, change: TreeChange): void {
    const editorStore = useEditorStore()
    switch (type) {
      case 'add': {
        const { pathname, isMarkdown } = change
        addFile(
          root.tree,
          change as Parameters<typeof addFile>[1],
          String(preferencesStore.fileSortBy),
          String(preferencesStore.fileSortOrder)
        )
        if (isMarkdown && newFileNameCache.value && pathname === newFileNameCache.value) {
          window.electron.ipcRenderer.send('mt::open-file', pathname, {})
          newFileNameCache.value = ''
        }
        break
      }
      case 'unlink':
        unlinkFile(root.tree, change)
        // Relocation preserves the save state; its old-path unlink is not an external deletion.
        if (!movingSource.value || !isWithinRoot(movingSource.value, change.pathname)) {
          editorStore.SET_SAVE_STATUS_WHEN_REMOVE(change)
        }
        break
      case 'addDir':
        addDirectory(root.tree, change)
        break
      case 'unlinkDir':
        unlinkDirectory(root.tree, change)
        break
      case 'change':
        if (change?.mtimeMs !== undefined) {
          updateFileMtime(
            root.tree,
            change as Parameters<typeof updateFileMtime>[1],
            String(preferencesStore.fileSortBy),
            String(preferencesStore.fileSortOrder)
          )
        }
        break
      default:
        if (window.electron?.process?.env?.NODE_ENV === 'development') {
          console.log(`Unknown directory watch type: "${type}"`)
        }
        break
    }

    // The mutations above are in place, so watchers need a counter to react to.
    if (root.restoring && (type === 'add' || type === 'addDir')) {
      const directory = type === 'addDir' ? change.pathname : window.path.dirname(change.pathname)
      const parts = window.path
        .relative(root.pathname, directory)
        .split(PATH_SEPARATOR)
        .filter(Boolean)
      let folder = root.tree
      for (const part of parts) {
        const child = folder.folders.find((item) => item.name === part)
        if (!child) break
        child.isCollapsed = root.collapsedPaths.has(
          window.path.relative(root.pathname, child.pathname)
        )
        folder = child
      }
    }
    treeVersion.value++
  }

  const isSameSelectionPath = (a: string, b: string): boolean =>
    normalizeHiddenSidebarPath(a) === normalizeHiddenSidebarPath(b)

  /** Project roots are single-select targets: they must never be hidden or trashed. */
  const isRootSelectionPath = (pathname: string): boolean => {
    const root = FIND_ROOT(pathname)
    return !!root && (
      isSameSelectionPath(root.pathname, pathname) ||
      isSameSelectionPath(root.key, pathname)
    )
  }

  /** True when `child` lives in a subtree below `parent`, not at the same path. */
  const isStrictlyWithin = (parent: string, child: string): boolean => {
    const parentKey = normalizeHiddenSidebarPath(parent)
    const childKey = normalizeHiddenSidebarPath(child)
    if (childKey === parentKey) return false
    const separator = parentKey.includes('\\') ? '\\' : '/'
    const prefix = parentKey.endsWith('/') || parentKey.endsWith('\\')
      ? parentKey
      : parentKey + separator
    return childKey.startsWith(prefix)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function CHANGE_ACTIVE_ITEM(item: any): void {
    activeItem.value = item
    // Right-clicking an already selected row keeps the multi-selection; a row
    // outside it falls back to single-select.
    const pathname = item?.pathname
    if (
      selectedPaths.value.length &&
      (typeof pathname !== 'string' || !selectedPaths.value.some(path => isSameSelectionPath(path, pathname)))
    ) {
      selectedPaths.value = []
    }
  }

  /** Plain row click: collapse to that row. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function SELECT_SINGLE(item: any): void {
    activeItem.value = item
    selectedPaths.value = []
  }

  /** Whether a row belongs to the current Ctrl/Cmd multi-selection. */
  function IS_MULTI_SELECTED(pathname: string): boolean {
    return selectedPaths.value.length > 1 && selectedPaths.value.some(path => isSameSelectionPath(path, pathname))
  }

  /** Ctrl/Cmd+click: add or remove a row from the multi-selection. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function TOGGLE_SELECTION(item: any): void {
    const pathname = item?.pathname
    if (typeof pathname !== 'string' || !pathname) return
    // Roots are single-select targets; Ctrl/Cmd+clicking one must not extend the
    // multi-selection (and must never make a project root hideable/trashable).
    if (isRootSelectionPath(pathname)) return
    // A plain click followed by Ctrl+click is the most common way to start a
    // multi-selection. The plain click only set `activeItem`, so seed the
    // selection with that row before adding the newly toggled one; otherwise
    // bulk hide/delete would silently skip the first row.
    if (!selectedPaths.value.length) {
      const active = activeItem.value?.pathname
      if (
        typeof active === 'string'
        && active
        && !isRootSelectionPath(active)
        && !isSameSelectionPath(active, pathname)
        // Never seed rows the user cannot see or that no longer exist: a
        // hidden row would otherwise be trashed invisibly and a stale row
        // would poison hiddenSidebarPaths for future files at that path.
        && FIND_TREE_NODE(active)
        && !isHiddenSidebarSelectionPath(active)
      )
        selectedPaths.value.push(active)
    }
    const index = selectedPaths.value.findIndex(path => isSameSelectionPath(path, pathname))
    if (index >= 0) {
      selectedPaths.value.splice(index, 1)
      // A deselected row must not stay the action target: move the focus to a
      // row that is still selected (or clear it) so Delete/F2 cannot retarget.
      const active = activeItem.value?.pathname
      if (typeof active === 'string' && isSameSelectionPath(active, pathname)) {
        const last = selectedPaths.value[selectedPaths.value.length - 1]
        activeItem.value = last ? selectionItem(last) : {}
      }
      return
    }
    selectedPaths.value.push(pathname)
    activeItem.value = item
  }

  /** Rebuilds a row payload for actions that only have a pathname at hand. */
  function selectionItem(pathname: string): Record<string, unknown> {
    const node = FIND_TREE_NODE(pathname)
    return node ? { ...node, pathname } : { pathname }
  }

  /** Whether the row is currently filtered out of the sidebar by the hide list. */
  function isHiddenSidebarSelectionPath(pathname: string): boolean {
    const key = normalizeHiddenSidebarPath(pathname)
    return preferencesStore.hiddenSidebarPaths.some(path => normalizeHiddenSidebarPath(path) === key)
  }

  function CLEAR_SELECTION(): void {
    activeItem.value = {}
    selectedPaths.value = []
  }

  /** Paths to act on: the whole multi-selection, or the single active item. */
  function SELECTION_PATHS(): string[] {
    const paths = selectedPaths.value.length > 1
      ? [...selectedPaths.value]
      : [activeItem.value?.pathname]
    // Roots are excluded here as well, so a stale entry can never hide/trash one.
    return paths.filter((pathname): pathname is string =>
      typeof pathname === 'string' && !!pathname && !isRootSelectionPath(pathname))
  }

  /** Drops trashed paths (and their descendants) from the selection state. */
  function REMOVE_SELECTION_PATHS(pathnames: readonly string[]): void {
    if (!pathnames.length) return
    const isRemoved = (pathname: string): boolean =>
      pathnames.some(path => isSameSelectionPath(path, pathname) || isStrictlyWithin(path, pathname))
    selectedPaths.value = selectedPaths.value.filter(path => !isRemoved(path))
    const active = activeItem.value?.pathname
    if (typeof active === 'string' && active && isRemoved(active)) {
      const last = selectedPaths.value[selectedPaths.value.length - 1]
      activeItem.value = last ? selectionItem(last) : {}
    }
  }

  /** Expands the folders leading to `pathname`; false when it is not in the tree. */
  function REVEAL_PATH(pathname: string | null | undefined): boolean {
    if (!pathname) return false
    const root = FIND_ROOT(pathname)
    if (!root) return false
    const expanded = expandAncestors(root.tree, TREE_PATH(pathname)) !== null
    if (expanded) scheduleWindowCheckpoint()
    return expanded
  }

  let openContainingFolderRequest = 0

  async function OPEN_CONTAINING_FOLDER(documentId?: string | null): Promise<void> {
    const editorStore = useEditorStore()
    const tab = documentId
      ? editorStore.tabs.find(item => item.id === documentId)
      : editorStore.currentFile
    if (!tab?.pathname) return
    const request = ++openContainingFolderRequest
    const activeDocumentId = editorStore.currentFile?.id
    try {
      const pathname = await window.electron.ipcRenderer.invoke(
        'mt::project-open-containing-folder',
        tab.id
      )
      if (
        !pathname ||
        request !== openContainingFolderRequest ||
        editorStore.currentFile?.id !== activeDocumentId
      ) return
      SHOW_FILES()
      // The explicit reveal retries as the directory watcher delivers the file tree.
      await nextTick()
      bus.emit('SIDEBAR::reveal-path', pathname)
    } catch (error) {
      notice.notify({
        title: t('contextMenu.tabs.openContainingFolder'),
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  function CHANGE_CLIPBOARD(data: ClipboardEntry | null): void {
    clipboard.value = data
  }

  // Rename and create share one "input is open" state, so they clear together.
  function CLEAR_NAME_INPUT_STATE(): void {
    createCache.value = {}
    renameCache.value = null
    nameInputValue.value = ''
  }

  // Clicking or blurring away accepts the edit, mirroring the Enter key and the
  // Finder / Windows Explorer gesture instead of discarding it (#3207, #3385).
  function COMMIT_NAME_INPUT(): void {
    const value = nameInputValue.value
    if (renameCache.value) {
      RENAME_IN_SIDEBAR(value)
      return
    }
    const { dirname } = createCache.value as CreateCacheEntry
    if (!dirname) return
    if (value) CREATE_FILE_DIRECTORY(value)
    else CLEAR_NAME_INPUT_STATE()
  }

  function SET_FOLDER_COLLAPSED(folder: TreeFolderNode, isCollapsed: boolean): void {
    folder.isCollapsed = isCollapsed
    const root = FIND_ROOT(folder.pathname)
    if (root) {
      const relative = window.path.relative(root.pathname, folder.pathname)
      root.collapsedPaths.delete(relative)
      if (isCollapsed) root.collapsedPaths.add(relative)
    }
    scheduleWindowCheckpoint()
  }

  function ASK_FOR_OPEN_PROJECT(): void {
    window.electron.ipcRenderer.send('mt::cmd-add-folder')
  }

  let stopSidebarContextMenu: (() => void) | null = null
  onScopeDispose(() => stopSidebarContextMenu?.())

  function LISTEN_FOR_SIDEBAR_CONTEXT_MENU(): () => void {
    // The store survives editor-page remounts, including Vue hot reloads.
    if (stopSidebarContextMenu) return stopSidebarContextMenu

    const unsubscribe: Array<() => void> = []
    const on = (event: string, handler: (value: unknown) => void): void => {
      bus.on(event, handler)
      unsubscribe.push(() => bus.off(event, handler))
    }
    on('SIDEBAR::show-in-folder', () => {
      const { pathname } = activeItem.value
      window.electron.shell.showItemInFolder(pathname)
    })
    on('SIDEBAR::copy-path', () => {
      const { pathname } = activeItem.value
      if (typeof pathname !== 'string' || !pathname) return
      window.electron.clipboard.writeText(pathname)
    })
    on('SIDEBAR::open-containing-folder', (documentId: unknown) => {
      void OPEN_CONTAINING_FOLDER(typeof documentId === 'string' ? documentId : null)
    })
    on('SIDEBAR::new', (type: unknown) => {
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : window.path.dirname(pathname)
      createCache.value = { dirname, type: String(type) }
      nameInputValue.value = ''
      bus.emit('SIDEBAR::show-new-input')
    })
    on('SIDEBAR::remove', async() => {
      // Delete acts on the whole Ctrl/Cmd/Shift selection, matching "hide".
      const paths = SELECTION_PATHS()
      if (!paths.length) return
      // Trashing a folder also removes its descendants; do not trash them twice.
      const targets = paths.filter(pathname =>
        !paths.some(other => isStrictlyWithin(other, pathname)))
      const trashedPaths: string[] = []
      for (const pathname of targets) {
        try {
          const trashed = await window.electron.ipcRenderer.invoke('mt::fs-trash-item', pathname)
          if (trashed) {
            // A trashed item must not linger in the hidden-files settings list.
            void usePreferencesStore().REMOVE_HIDDEN_SIDEBAR_ITEM(pathname)
            trashedPaths.push(pathname)
          }
        } catch (err) {
          notice.notify({
            title: 'Error while deleting',
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }
      // The nodes are gone; drop them from the selection so Delete cannot retarget.
      REMOVE_SELECTION_PATHS(trashedPaths)
    })
    on('SIDEBAR::copy-cut', (type: unknown) => {
      const { pathname: src } = activeItem.value
      clipboard.value = { type: String(type), src }
    })
    on('SIDEBAR::paste', async() => {
      const cb = clipboard.value
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : window.path.dirname(pathname)
      if (cb && cb.src) {
        let dest = dirname + PATH_SEPARATOR + window.path.basename(cb.src)

        if (window.path.normalize(cb.src) === window.path.normalize(dest)) {
          if (cb.type === 'cut') {
            notice.notify({
              title: 'Paste Forbidden',
              type: 'warning',
              message: 'Source and destination must not be the same.'
            })
            return
          }
          // Copy in same folder: generate unique name (e.g. "file (copy).md", "file (copy 2).md")
          const ext = window.path.extname(cb.src)
          const base = window.path.basename(cb.src, ext)
          let suffix = 1
          const MAX_COPIES = 99
          dest = dirname + PATH_SEPARATOR + base + ' (copy)' + ext
          while (await window.fileUtils.pathExists(dest)) {
            suffix++
            if (suffix > MAX_COPIES) {
              notice.notify({
                title: 'Too many copies',
                type: 'warning',
                message: `Maximum of ${MAX_COPIES} copies reached. Please clean up first.`
              })
              return
            }
            dest = dirname + PATH_SEPARATOR + base + ` (copy ${suffix})` + ext
          }
        }

        cb.dest = dest

        paste(cb as PasteOptions)
          .then(async() => {
            // A cut is a move: carry hidden state to the new location.
            if (cb.type === 'cut' && cb.src)
              await usePreferencesStore().RENAME_HIDDEN_SIDEBAR_ITEM(cb.src, dest)
            clipboard.value = null
          })
          .catch((err) => {
            notice.notify({
              title: 'Error while pasting',
              type: 'error',
              message: err instanceof Error ? err.message : String(err)
            })
          })
      }
    })
    on('SIDEBAR::rename', () => {
      const { pathname } = activeItem.value
      renameCache.value = pathname
      nameInputValue.value = typeof pathname === 'string' ? window.path.basename(pathname) : ''
      bus.emit('SIDEBAR::show-rename-input')
    })
    stopSidebarContextMenu = () => {
      for (const off of unsubscribe) off()
      stopSidebarContextMenu = null
    }
    return stopSidebarContextMenu
  }

  async function CREATE_FILE_DIRECTORY(name: string): Promise<void> {
    const cache = createCache.value as CreateCacheEntry
    const { dirname, type } = cache
    // A second call after the input closed (or with no create target) is a no-op.
    if (!dirname) return
    // Close the input before the async work: a later click then sees no open
    // input and cannot submit the same edit twice.
    CLEAR_NAME_INPUT_STATE()

    if (type === 'file' && !window.fileUtils.hasMarkdownExtension(name)) {
      name += '.md'
    }

    const fullName = dirname + PATH_SEPARATOR + name

    try {
      // Creating over an existing path would silently overwrite it (outputFile
      // truncates). Refuse instead of destroying the existing file (#1946).
      if (await window.fileUtils.pathExists(fullName)) {
        notice.notify({
          title: 'Error in Side Bar',
          type: 'error',
          message: `A ${type} named "${name}" already exists in this folder.`
        })
        return
      }

      await create(fullName, type as FileCreateType)
      if (type === 'file') {
        newFileNameCache.value = fullName
      }
    } catch (err) {
      notice.notify({
        title: 'Error in Side Bar',
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  function RENAME_IN_SIDEBAR(name: string): void {
    const editorStore = useEditorStore()
    const src = renameCache.value
    if (!src) return
    // Close the input before the async work: a later click then sees no open
    // input and cannot submit the same rename twice.
    CLEAR_NAME_INPUT_STATE()
    // An empty name would move the node onto its parent directory.
    if (!name) return
    const dirname = window.path.dirname(src)
    const dest = dirname + PATH_SEPARATOR + name
    if (window.path.normalize(dest) === window.path.normalize(src)) return
    rename(src, dest)
      .then(async() => {
        // Keep the selection on the new path so a following F2 / Delete acts on
        // the renamed node instead of the one that no longer exists.
        if (activeItem.value?.pathname === src) {
          activeItem.value = {
            ...activeItem.value,
            pathname: dest,
            name: window.path.basename(dest)
          }
        }
        // Carry the multi-selection to the new path too.
        const normalizedSrc = window.path.normalize(src)
        selectedPaths.value = selectedPaths.value.map((path) => {
          if (isSameSelectionPath(path, src)) return dest
          if (isStrictlyWithin(src, path))
            return dest + window.path.normalize(path).slice(normalizedSrc.length)
          return path
        })
        // Carry hidden state over to the new path (including descendants when
        // a hidden folder is renamed), otherwise it silently reappears.
        await usePreferencesStore().RENAME_HIDDEN_SIDEBAR_ITEM(src, dest)
        editorStore.RENAME_IF_NEEDED({ src, dest })
      })
      .catch((err) => {
        notice.notify({
          title: 'Error while renaming',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
  }

  function OPEN_SETTING_WINDOW(): void {
    window.electron.ipcRenderer.send('mt::open-setting-window')
  }

  return {
    activeItem,
    selectedPaths,
    createCache,
    newFileNameCache,
    renameCache,
    nameInputValue,
    clipboard,
    projectTree,
    restoringSession,
    roots,
    availableRoots,
    FIND_ROOT,
    ROOT_BASE,
    TREE_PATH,
    FIND_TREE_NODE,
    GET_DEFAULT_DIRECTORY,
    ROOT_LABEL,
    FILE_LABEL,
    APPLY_ROOTS,
    treeVersion,
    movingSource,
    CAPTURE_PROJECT_VIEW,
    RESTORE_PROJECT_VIEW,
    LISTEN_FOR_LOAD_PROJECT,
    LISTEN_FOR_UPDATE_PROJECT,
    CHANGE_ACTIVE_ITEM,
    SELECT_SINGLE,
    IS_MULTI_SELECTED,
    TOGGLE_SELECTION,
    CLEAR_SELECTION,
    SELECTION_PATHS,
    REVEAL_PATH,
    OPEN_CONTAINING_FOLDER,
    CHANGE_CLIPBOARD,
    CLEAR_NAME_INPUT_STATE,
    COMMIT_NAME_INPUT,
    SET_FOLDER_COLLAPSED,
    ASK_FOR_OPEN_PROJECT,
    LISTEN_FOR_SIDEBAR_CONTEXT_MENU,
    CREATE_FILE_DIRECTORY,
    RENAME_IN_SIDEBAR,
    OPEN_SETTING_WINDOW
  }
})
