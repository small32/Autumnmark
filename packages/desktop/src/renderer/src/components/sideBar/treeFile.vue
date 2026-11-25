<template>
  <div
    ref="fileEl"
    :title="file.pathname"
    class="side-bar-file"
    :data-tree-path="file.pathname"
    data-tree-directory="false"
    :draggable="!renameCache && !projectStore.createCache.dirname"
    :style="{ opacity: file.isMarkdown ? 1 : 0.75 }"
    :class="[
      {
        current: currentFile?.pathname === file.pathname,
        active: file.id === activeItem.id,
        'multi-selected': multiSelected
      }
    ]"
    @click="handleFileClick"
    @dblclick="handleFileDblClick"
  >
    <file-icon
      :name="file.name"
      aria-hidden="true"
    />
    <input
      v-if="renameCache === file.pathname"
      ref="renameInput"
      v-model="nameInputValue"
      type="text"
      class="rename"
      @click.stop="noop"
      @keypress.enter="rename"
    >
    <span v-else>{{ file.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import FileIcon from './icon.vue'
import { showContextMenu } from '../../contextMenu/sideBar'
import bus from '../../bus'
import { renameSelectionEnd } from './renameKey'
import { useTreeRow } from './rowRegistry'
import type { TreeFileNode } from './types'

const props = defineProps<{
  file: TreeFileNode
}>()

const projectStore = useProjectStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const fileEl = ref<HTMLDivElement | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)

useTreeRow(() => props.file.pathname, fileEl)

const { renameCache } = storeToRefs(projectStore)
const { nameInputValue } = storeToRefs(projectStore)
const { activeItem } = storeToRefs(projectStore)
const { clipboard } = storeToRefs(projectStore)
const { currentFile, tabs } = storeToRefs(editorStore)

const multiSelected = computed(() => projectStore.IS_MULTI_SELECTED(props.file.pathname))

const handleFileClick = (event: MouseEvent): void => {
  // Ctrl/Cmd+click toggles the row into the multi-selection without opening it.
  if (event.ctrlKey || event.metaKey) {
    projectStore.TOGGLE_SELECTION(props.file)
    return
  }
  // Select before the open-file branch runs, so non-markdown rows select too.
  projectStore.SELECT_SINGLE(props.file)
  // A double-click's second click must not re-issue the open request.
  if (event.detail === 2) return
  const { isMarkdown, pathname } = props.file
  if (!isMarkdown) return
  const openedTab = tabs.value.find((f) => window.fileUtils.isSamePathSync(f.pathname, pathname))
  if (openedTab) {
    editorStore.CANCEL_PENDING_SIDEBAR_OPEN()
    if (currentFile.value?.pathname === openedTab.pathname) {
      return
    }
    editorStore.UPDATE_CURRENT_FILE(openedTab)
    // Restoring the tab's caret pulls DOM focus into the editor.
    bus.emit('SIDEBAR::focus-tree')
  } else {
    const preview = preferencesStore.openFilesInPreviewMode
    const requestId = editorStore.BEGIN_SIDEBAR_OPEN(pathname, preview)
    if (requestId == null) return
    window.electron.ipcRenderer.send('mt::open-file', pathname, { preview, requestId })
  }
}

const handleFileDblClick = (): void => {
  if (!props.file.isMarkdown) return
  editorStore.FOCUS_FILE(props.file.pathname)
}

const noop = (): void => {}

const handleFileContextMenu = (event: MouseEvent): void => {
  event.preventDefault()
  // CHANGE_ACTIVE_ITEM keeps a multi-selection when the target is one of its
  // rows, and otherwise falls back to a single selection of this file.
  projectStore.CHANGE_ACTIVE_ITEM(props.file)
  showContextMenu(event, !!clipboard.value, props.file)
}

const focusRenameInput = (): void => {
  // The `v-if` input mounts on the next tick; the store seeds its value.
  nextTick(() => {
    if (!renameInput.value) return
    renameInput.value.focus()
    renameInput.value.setSelectionRange(0, renameSelectionEnd(props.file.name))
  })
}

const rename = (): void => {
  projectStore.RENAME_IN_SIDEBAR(nameInputValue.value)
}

onMounted(() => {
  if (fileEl.value) {
    fileEl.value.addEventListener('contextmenu', handleFileContextMenu)
  }

  bus.on('SIDEBAR::show-rename-input', focusRenameInput)
})

onBeforeUnmount(() => {
  fileEl.value?.removeEventListener('contextmenu', handleFileContextMenu)
  bus.off('SIDEBAR::show-rename-input', focusRenameInput)
})

</script>

<style scoped>
.side-bar-file {
  display: flex;
  align-items: center;
  cursor: default;
  user-select: none;
  height: var(--tree-node-height);
  min-width: var(--tree-node-min-width);
  box-sizing: border-box;
  border-radius: 5px;
  padding-inline: var(--tree-chevron-width) 7px;
  &:hover {
    background: var(--sideBarItemHoverBgColor);
  }
  & > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  & > .file-icon {
    width: 16px;
  }
}
.side-bar-file.current > span {
  color: var(--editorColor80);
  font-weight: 600;
}
/* After :hover so the selection stays visible while the pointer is over it. */
.side-bar-file.active {
  background: var(--themeColor20);
}
.side-bar-file.active > span {
  color: var(--sideBarTitleColor);
}
/* Ctrl/Cmd+click multi-selection: outline keeps the active row distinguishable. */
.side-bar-file.multi-selected {
  background: var(--themeColor20);
  box-shadow: inset 0 0 0 1px var(--focusColor);
}
input.rename {
  height: 22px;
  outline: none;
  margin: 5px 0;
  padding: 0 8px;
  color: var(--sideBarColor);
  border: 1px solid var(--focusColor);
  background: var(--floatBorderColor);
  width: 100%;
  min-width: 0;
  border-radius: 3px;
}
</style>
