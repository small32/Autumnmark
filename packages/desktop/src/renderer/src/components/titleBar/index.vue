<template>
  <header
    class="title-bar-editor-bg"
    :class="{
      'tabs-visible': showTabBar,
      'mica-title-bar': micaTitleBar && showCustomTitleBar && active
    }"
  >
    <div
      class="title-bar"
      :class="[
        { active: active },
        { 'tabs-visible': showTabBar },
        { frameless: titleBarStyle === 'custom' },
        { 'has-menubar': showCustomTitleBar },
        { isOsx: isOsx }
      ]"
    >
      <application-menu v-if="showCustomTitleBar" />
      <div
        v-if="titleBarStyle !== 'native' || isOsx"
        class="title"
        @dblclick.stop="toggleMaxmizeOnMacOS"
      >
        <span class="title-brand" :class="{ 'with-filename': filename }">
          <img v-if="filename" :src="AppLogo" alt="" width="16" height="16" draggable="false" />
          <span class="brand-name">{{ APP_NAME }}</span>
        </span>
        <template v-if="filename">
          <span class="save-dot" :class="{ show: !isSaved }" />
          <bdi class="filename" :class="{ isOsx }" :title="filename" @click="rename">{{ filename }}</bdi>
        </template>
      </div>
      <div class="title-actions">
        <div :class="showCustomTitleBar ? 'statistics-toolbar title-no-drag' : 'right-toolbar'">
          <button
            v-if="updates.showProgressButton"
            type="button"
            class="plain-button update-trigger title-no-drag"
            :aria-label="t('updates.title')"
            :title="updates.status"
            aria-haspopup="dialog"
            @click="updates.visible = true"
          >
            <el-icon :size="16">
              <Warning v-if="updates.state.phase === 'error'" />
              <CircleCheck v-else-if="updates.state.phase === 'ready'" />
              <Download v-else />
            </el-icon>
            <span>{{ updates.percent === null ? t('updates.title') : `${updates.percent}%` }}</span>
          </button>
        </div>
        <div
          v-if="titleBarStyle === 'custom' && !isFullScreen && !isOsx"
          class="right-toolbar window-controls"
          :class="[{ 'title-no-drag': titleBarStyle === 'custom' }]"
        >
          <icon-tooltip :content="t('titleBar.minimize')">
            <button
              type="button"
              class="plain-button frameless-titlebar-button frameless-titlebar-minimize"
              :aria-label="t('titleBar.minimize')"
              @click.stop="handleMinimizeClick"
            >
              <span>
                <svg
                  width="10"
                  height="10"
                >
                  <path :d="windowIconMinimize" />
                </svg>
              </span>
            </button>
          </icon-tooltip>
          <icon-tooltip :content="maximizeLabel">
            <button
              type="button"
              class="plain-button frameless-titlebar-button frameless-titlebar-toggle"
              :aria-label="maximizeLabel"
              @click.stop="handleMaximizeClick"
            >
              <span>
                <svg
                  width="10"
                  height="10"
                >
                  <path
                    v-show="!isMaximized"
                    :d="windowIconMaximize"
                  />
                  <path
                    v-show="isMaximized"
                    :d="windowIconRestore"
                  />
                </svg>
              </span>
            </button>
          </icon-tooltip>
          <icon-tooltip
            :content="t('titleBar.close')"
            placement="bottom-end"
          >
            <button
              type="button"
              class="plain-button frameless-titlebar-button frameless-titlebar-close"
              :aria-label="t('titleBar.close')"
              @click.stop="handleCloseClick"
            >
              <span>
                <svg
                  width="10"
                  height="10"
                >
                  <path :d="windowIconClose" />
                </svg>
              </span>
            </button>
          </icon-tooltip>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { usePreferencesStore } from '@/store/preferences.js'
import { useLayoutStore } from '@/store/layout.js'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { minimizePath, restorePath, maximizePath, closePath } from '../../assets/window-controls.js'
import { isMac as isOsxPlatform } from '@/util'
import { buildWindowTitle } from './windowTitle'
import { useEditorStore } from '@/store/editor'
import { useI18n } from 'vue-i18n'
import { useAutoUpdatesStore } from '@/store/autoUpdates'
import { CircleCheck, Download, Warning } from '@element-plus/icons-vue'
import IconTooltip from '@/components/iconTooltip/index.vue'
import ApplicationMenu from './applicationMenu.vue'
import AppLogo from '@/assets/images/logo.png'
import { APP_NAME } from '@shared/brand'

const props = defineProps<{
  filename?: string
  active?: boolean
  platform?: string
  isSaved?: boolean
}>()

const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const editorStore = useEditorStore()
const updates = useAutoUpdatesStore()
const { t } = useI18n()

const isOsx = isOsxPlatform
const micaTitleBar = window.marktext?.env?.micaTitleBar
const windowIconMinimize = minimizePath
const windowIconRestore = restorePath
const windowIconMaximize = maximizePath
const windowIconClose = closePath

const isFullScreen = ref(false)
const isMaximized = ref(false)

onMounted(async () => {
  try {
    const [fs, max] = await Promise.all([
      window.electron.windowControl.isFullScreen(),
      window.electron.windowControl.isMaximized()
    ])
    isFullScreen.value = !!fs
    isMaximized.value = !!max
  } catch {
    // Window state is best-effort; keep the previous values if the query fails.
  }
})

const { titleBarStyle } = storeToRefs(preferencesStore)
const { showTabBar } = storeToRefs(layoutStore)

const showCustomTitleBar = computed(() => {
  return titleBarStyle.value === 'custom' && !isOsx
})

const maximizeLabel = computed(() =>
  isMaximized.value ? t('titleBar.restore') : t('titleBar.maximize')
)

watch(
  () => props.filename,
  filename => { document.title = buildWindowTitle(filename) },
  { immediate: true }
)

const handleCloseClick = () => {
  window.electron.windowControl.close()
}

const handleMaximizeClick = async () => {
  if (isFullScreen.value) {
    window.electron.windowControl.setFullScreen(false)
    return
  }
  if (isMaximized.value) window.electron.windowControl.unmaximize()
  else window.electron.windowControl.maximize()
}

const toggleMaxmizeOnMacOS = () => {
  if (isOsx) {
    handleMaximizeClick()
  }
}

const handleMinimizeClick = () => {
  window.electron.windowControl.minimize()
}

const rename = () => {
  if (props.platform === 'darwin') {
    editorStore.RESPONSE_FOR_RENAME()
  }
}

const onMaximize = () => {
  isMaximized.value = true
}
const onUnmaximize = () => {
  isMaximized.value = false
}
const onEnterFullScreen = () => {
  isFullScreen.value = true
}
const onLeaveFullScreen = () => {
  isFullScreen.value = false
}

const offMaximize = window.electron.ipcRenderer.on('mt::window-maximize', onMaximize)
const offUnmaximize = window.electron.ipcRenderer.on('mt::window-unmaximize', onUnmaximize)
const offEnterFullScreen = window.electron.ipcRenderer.on(
  'mt::window-enter-full-screen',
  onEnterFullScreen
)
const offLeaveFullScreen = window.electron.ipcRenderer.on(
  'mt::window-leave-full-screen',
  onLeaveFullScreen
)

onBeforeUnmount(() => {
  offMaximize()
  offUnmaximize()
  offEnterFullScreen()
  offLeaveFullScreen()
})
</script>

<style scoped>
.title-bar-editor-bg {
  flex: none;
  background: var(--editorBgColor);
}
.title-bar {
  -webkit-app-region: drag;
  user-select: none;
  background: transparent;
  height: var(--titleBarHeight);
  box-sizing: border-box;
  color: var(--editorColor50);
  position: relative;
  z-index: 2;
  transition: color 0.4s ease-in-out;
  cursor: default;
}
.active {
  color: var(--editorColor);
}
.title {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding-inline: 8px;
  height: 100%;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
}
.title-brand {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  line-height: 16px;
}
.title-brand.with-filename {
  padding-inline-end: 8px;
  border-inline-end: 1px solid var(--editorColor30);
}
.title-bar.isOsx .title {
  margin-inline: 90px;
}
.filename {
  overflow: hidden;
  text-overflow: ellipsis;
}
.filename.isOsx { -webkit-app-region: no-drag; }
.filename.isOsx:hover { color: var(--themeColor); }
.title-actions { display: flex; justify-content: flex-end; align-items: center; height: 100%; }
.save-dot {
  flex: none;
  margin-inline: 4px;
  width: 8px;
  height: 8px;
  display: inline-block;
  border-radius: 50%;
  background: var(--highlightThemeColor);
  opacity: 0.7;
  visibility: hidden;
}
.save-dot.show {
  visibility: visible;
}
.has-menubar {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
  align-items: center;
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--sideBarBgColor), var(--editorBgColor)),
    var(--editorColor) 7%
  );
}
.title-bar-editor-bg.mica-title-bar,
.mica-title-bar .has-menubar {
  background: transparent;
}
.has-menubar :deep(.application-menubar) {
  width: max-content;
  max-width: min(55vw, calc(100vw - 200px));
}
.update-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-inline: 2px;
  padding: 4px 6px;
  border-radius: 5px;
  color: var(--themeColor);
  background: var(--themeColor10);
  white-space: nowrap;
  font-size: 12px;
}

.right-toolbar .update-trigger > span {
  display: none;
}

.statistics-toolbar {
  flex: none;
  padding-left: 8px;
  height: 100%;
  display: flex;
  align-items: center;
}
.has-menubar .window-controls {
  position: static;
  flex: none;
}
@media (max-width: 900px) {
  .update-trigger > span { display: none; }
}
@media (max-width: 760px) {
  .title-brand.with-filename { padding-inline-end: 0; border: 0; }
  .title-brand.with-filename .brand-name { display: none; }
  .has-menubar :deep(.application-menubar) { max-width: 48vw; }
}
.right-toolbar {
  height: 100%;
  position: absolute;
  top: 0;
  right: 0;
  width: 190px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  & .item {
    margin-right: 10px;
  }
}

.title-no-drag {
  -webkit-app-region: no-drag;
}
.frameless-titlebar-button {
  position: relative;
  display: block;
  width: 46px;
  height: var(--titleBarHeight);
  color: var(--editorColor);
}
.window-controls {
  width: 138px;
}
.frameless-titlebar-button > span {
  position: absolute;
  display: inline-flex;
  top: 50%;
  left: 50%;
  transform: translateX(-50%) translateY(-50%);
}
.frameless-titlebar-close:hover {
  background-color: rgb(228, 79, 79);
}
.frameless-titlebar-minimize:hover,
.frameless-titlebar-toggle:hover {
  background-color: var(--editorColor10);
}
.frameless-titlebar-button svg {
  fill: currentColor;
}
.frameless-titlebar-close:hover svg {
  fill: #ffffff;
}
</style>
