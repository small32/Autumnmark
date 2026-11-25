<template>
  <div class="pref-general">
    <h4 v-if="!embedded">
      {{ t('preferences.general.title') }}
    </h4>
    <compound v-if="show('language')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.language.title') }}
        </h6>
      </template>
      <template #children>
        <cur-select
          id="setting-language"
          :description="preferenceLabel('language')"
          :value="language"
          :options="getLanguageOptions()"
          :on-change="(value) => onSelectChange('language', value)"
        />
      </template>
    </compound>
    <compound v-if="show('opening')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.openingMode') }}
        </h6>
      </template>
      <template #children>
        <cur-select
          id="setting-defaultOpenMode"
          :description="preferenceLabel('defaultOpenMode')"
          :notes="preferenceNotes('defaultOpenMode')"
          :value="defaultOpenMode"
          :options="[
            { label: t('readingMode.edit'), value: 'edit' },
            { label: t('readingMode.title'), value: 'read' }
          ]"
          :on-change="(value) => onSelectChange('defaultOpenMode', value)"
        />
      </template>
    </compound>
    <compound v-if="show('save')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.autoSave.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-autoSave"
          :description="preferenceLabel('autoSave')"
          :bool="autoSave"
          :on-change="(value) => onSelectChange('autoSave', value)"
        />
        <range
          id="setting-autoSaveDelay"
          :description="preferenceLabel('autoSaveDelay')"
          :value="autoSaveDelay"
          :min="1000"
          :max="10000"
          unit="ms"
          :step="100"
          :on-change="(value) => onSelectChange('autoSaveDelay', value)"
        />
      </template>
    </compound>

    <compound v-if="show('windowAppearance') || show('windowOpening')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.window.title') }}
        </h6>
      </template>
      <template #children>
        <cur-select
          v-if="!isMac && show('windowAppearance')"
          id="setting-titleBarStyle"
          :description="preferenceLabel('titleBarStyle')"
          :notes="preferenceNotes('titleBarStyle')"
          :value="titleBarStyle"
          :options="getTitleBarStyleOptions()"
          :on-change="(value) => onSelectChange('titleBarStyle', value)"
        />
        <bool
          v-if="show('windowAppearance')"
          id="setting-hideScrollbar"
          :description="preferenceLabel('hideScrollbar')"
          :bool="hideScrollbar"
          :on-change="(value) => onSelectChange('hideScrollbar', value)"
        />
        <bool
          v-if="show('windowOpening')"
          id="setting-openFilesInNewWindow"
          :description="preferenceLabel('openFilesInNewWindow')"
          :notes="preferenceNotes('openFilesInNewWindow')"
          :bool="openFilesInNewWindow"
          :on-change="(value) => onSelectChange('openFilesInNewWindow', value)"
        />
        <bool
          v-if="show('windowOpening')"
          id="setting-openFolderInNewWindow"
          :description="preferenceLabel('openFolderInNewWindow')"
          :notes="preferenceNotes('openFolderInNewWindow')"
          :bool="openFolderInNewWindow"
          :on-change="(value) => onSelectChange('openFolderInNewWindow', value)"
        />
        <cur-select
          v-if="show('windowAppearance')"
          id="setting-zoom"
          :description="preferenceLabel('zoom')"
          :value="zoom"
          :options="zoomOptions"
          :on-change="(value) => onSelectChange('zoom', value)"
        />
      </template>
    </compound>

    <compound v-if="show('navigation')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.sidebar.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-wordWrapInToc"
          :description="preferenceLabel('wordWrapInToc')"
          :bool="wordWrapInToc"
          :on-change="(value) => onSelectChange('wordWrapInToc', value)"
        />
        <bool
          id="setting-openedFilesInSidebar"
          :description="preferenceLabel('openedFilesInSidebar')"
          :bool="openedFilesInSidebar"
          :on-change="(value) => onSelectChange('openedFilesInSidebar', value)"
        />
        <bool
          id="setting-autoRevealInSidebar"
          :description="preferenceLabel('autoRevealInSidebar')"
          :bool="autoRevealInSidebar"
          :on-change="(value) => onSelectChange('autoRevealInSidebar', value)"
        />
        <bool
          id="setting-openFilesInPreviewMode"
          :description="preferenceLabel('openFilesInPreviewMode')"
          :bool="openFilesInPreviewMode"
          :on-change="(value) => onSelectChange('openFilesInPreviewMode', value)"
        />

        <exclude-patterns
          id="setting-treePathExcludePatterns"
          :value="preferenceStore.treePathExcludePatterns"
          :update="updateExcludePatterns"
          @persisted="acceptRecoveryPreferences"
        />

        <hidden-files />

        <cur-select
          id="setting-fileSortBy"
          :description="preferenceLabel('fileSortBy')"
          :value="fileSortBy"
          :options="getFileSortByOptions()"
          :on-change="(value) => onSelectChange('fileSortBy', value)"
        />
        <cur-select
          id="setting-fileSortOrder"
          :description="preferenceLabel('fileSortOrder')"
          :value="fileSortOrder"
          :options="getFileSortOrderOptions(String(fileSortBy))"
          :on-change="(value) => onSelectChange('fileSortOrder', value)"
        />
      </template>
    </compound>

    <recovery-settings
      v-if="show('recovery')"
      :value="preferenceStore"
      :update="updateRecoveryPreferences"
      :choose-directory="chooseRecoveryDirectory"
      @persisted="acceptRecoveryPreferences"
    />
    <!-- Keep status readable independently of the disabled conversion switch. -->
    <compound v-if="show('pandoc')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.pandoc.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-showPandocConvert"
          :description="preferenceLabel('showPandocConvert')"
          :detailed-description="t('preferences.general.pandoc.detailedDescription')"
          :bool="showPandocConvert"
          :disable="pandocDisabled"
          :on-change="(value) => onSelectChange('showPandocConvert', value)"
        />
        <command-detection
          :state="pandocDetectionState"
          :message="pandocStatus"
          @check="probePandoc"
        />
      </template>
    </compound>

    <compound v-if="show('updates')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.general.updates.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-checkUpdatesOnStartup"
          :description="preferenceLabel('checkUpdatesOnStartup')"
          :notes="preferenceNotes('checkUpdatesOnStartup')"
          :bool="checkUpdatesOnStartup"
          :on-change="(value) => onSelectChange('checkUpdatesOnStartup', value)"
        />
        <!-- Package-manager installs (deb/rpm/snap) cannot replace themselves,
             so the download switch would have nothing to control. -->
        <bool
          v-if="installable"
          id="setting-onlineUpdateEnabled"
          :description="preferenceLabel('onlineUpdateEnabled')"
          :notes="preferenceNotes('onlineUpdateEnabled')"
          :bool="onlineUpdateEnabled"
          :on-change="(value) => onSelectChange('onlineUpdateEnabled', value)"
        />
        <div class="update-check">
          <el-button
            v-if="checkable"
            type="primary"
            :loading="updateChecking"
            @click="checkForUpdates"
          >
            {{ t('preferences.general.updates.checkNow') }}
          </el-button>
          <!-- The update dialog is suppressed when notices are off, so the
               settings page must offer every update action itself. -->
          <el-button
            v-if="updateDownloadable"
            type="primary"
            @click="updates.download()"
          >
            {{ t('updates.download') }}
          </el-button>
          <el-button
            v-if="updateCancellable"
            @click="updates.cancel()"
          >
            {{ t('updates.cancel') }}
          </el-button>
          <el-button
            v-if="updateInstallable"
            type="primary"
            @click="updates.install()"
          >
            {{ t('updates.install') }}
          </el-button>
          <el-button
            v-if="updateReleaseAvailable"
            @click="updates.openRelease()"
          >
            {{ t('updates.openRelease') }}
          </el-button>
          <el-button
            v-if="updateRetryable"
            type="primary"
            @click="updates.retry()"
          >
            {{ t('updates.retry') }}
          </el-button>
        </div>
        <div
          v-if="updateDownloading"
          class="update-progress"
        >
          <div
            class="update-progress-bar"
            :class="{ indeterminate: updatePercent === null }"
            role="progressbar"
            :aria-valuenow="updatePercent ?? undefined"
            :aria-label="t('updates.title')"
          >
            <span :style="{ width: (updatePercent ?? 100) + '%' }" />
          </div>
          <div class="update-progress-meta">
            <span role="status">{{ updateStatus }}</span>
            <span v-if="updatePercent !== null">{{ updatePercent }}%</span>
            <span v-if="updateProgress">
              {{ sizeText }}
              <template v-if="updateProgress.total > 0"> / {{ totalText }}</template>
            </span>
            <span v-if="speedText">{{ speedText }}</span>
          </div>
        </div>
        <p
          v-if="checkable && !installable"
          class="update-note"
        >
          {{ t('preferences.general.updates.unavailable') }}
        </p>
      </template>
    </compound>
  </div>
</template>

<script setup lang="ts">
import { preferenceLabel, preferenceNotes } from '@/prefComponents/registry'

import { computed, onMounted, ref } from 'vue'
import RecoverySettings from './recoverySettings.vue'
import ExcludePatterns from './excludePatterns.vue'
import HiddenFiles from './hiddenFiles.vue'
import type { UserPreferences, RecoveryPreferences } from '@shared/types/preferences'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import { useAutoUpdatesStore } from '@/store/autoUpdates'
import Compound from '../common/compound/index.vue'
import CommandDetection from '../common/commandDetection.vue'
import type { CommandDetectionState } from '../common/types'
import Range from '../common/range/index.vue'
import CurSelect from '../common/select/index.vue'
import Bool from '../common/bool/index.vue'
import { pandocSwitchState } from './pandoc'
import type { PandocCommandInfo } from '@shared/types/pandoc'
import { isMac } from '@/util'

import {
  getTitleBarStyleOptions,
  zoomOptions,
  getFileSortByOptions,
  getFileSortOrderOptions,
  getLanguageOptions
} from './config'

const props = withDefaults(defineProps<{ groups?: readonly string[]; embedded?: boolean }>(), {
  groups: () => ['all'],
  embedded: false
})
const show = (group: string): boolean => props.groups.includes('all') || props.groups.includes(group)

const { t, locale } = useI18n()
const preferenceStore = usePreferencesStore()
const acceptRecoveryPreferences = (preferences: UserPreferences): void => {
  preferenceStore.SET_USER_PREFERENCE({ ...preferences })
}
const updateRecoveryPreferences = (patch: Partial<RecoveryPreferences>) => window.electron.ipcRenderer.invoke('mt::preferences::update', patch)
const updateExcludePatterns = (patch: Pick<UserPreferences, 'treePathExcludePatterns'>) => window.electron.ipcRenderer.invoke('mt::preferences::update', patch)
const chooseRecoveryDirectory = () => window.electron.ipcRenderer.invoke('mt::preferences::choose-directory')

const {
  defaultOpenMode,
  autoSave,
  autoSaveDelay,
  titleBarStyle,
  openFilesInNewWindow,
  openFolderInNewWindow,
  zoom,
  hideScrollbar,
  wordWrapInToc,
  fileSortBy,
  fileSortOrder,
  language,
  openedFilesInSidebar,
  autoRevealInSidebar,
  openFilesInPreviewMode,
  showPandocConvert,
  checkUpdatesOnStartup,
  onlineUpdateEnabled
} = storeToRefs(preferenceStore)

const updates = useAutoUpdatesStore()
const { status: updateStatus } = storeToRefs(updates)
// Portable ZIPs and unsigned macOS builds are replaced by the bundled updater
// script, so they can install in place; deb/rpm/snap cannot.
const installable = window.electron.canInstallInPlace === true
const checkable = window.electron.canCheckForUpdates === true
const updateChecking = computed(() => updates.state.phase === 'checking')
const updateDownloadable = computed(() =>
  installable && updates.state.phase === 'available' && updates.onlineEnabled)
const updateCancellable = computed(() => updates.state.phase === 'downloading')
// A staged package can be applied from here even when the update dialog is
// suppressed by the "check on startup" switch.
const updateInstallable = computed(() =>
  installable && updates.state.phase === 'ready' && updates.onlineEnabled)
const updateReleaseAvailable = computed(() => updates.state.phase === 'available')
const updateRetryable = computed(() => updates.state.phase === 'error')
const updateDownloading = computed(() => updates.state.phase === 'downloading')
const updatePercent = computed(() => updates.percent)
const updateProgress = computed(() => updates.progress)
const sizeFormatter = computed(() => new Intl.NumberFormat(locale.value, {
  style: 'unit', unit: 'megabyte', maximumFractionDigits: 1
}))
const speedFormatter = computed(() => new Intl.NumberFormat(locale.value, {
  style: 'unit', unit: 'megabyte-per-second', maximumFractionDigits: 2
}))
const sizeText = computed(() => updateProgress.value
  ? sizeFormatter.value.format(updateProgress.value.transferred / 1e6)
  : '')
const totalText = computed(() => updateProgress.value && updateProgress.value.total > 0
  ? sizeFormatter.value.format(updateProgress.value.total / 1e6)
  : '')
const speedText = computed(() => updateProgress.value && updateProgress.value.bytesPerSecond > 0
  ? speedFormatter.value.format(updateProgress.value.bytesPerSecond / 1e6)
  : '')
const checkForUpdates = (): void => {
  window.electron.ipcRenderer.send('mt::check-for-update')
}

const pandocProbe = ref<PandocCommandInfo | null>(null)
const isProbing = ref(false)
const probeFailed = ref(false)
const pandocDetectionState = computed<CommandDetectionState>(() => {
  if (isProbing.value || !pandocProbe.value) return 'checking'
  if (probeFailed.value) return 'failed'
  return pandocProbe.value.command ? 'found' : 'not-found'
})

const pandocSwitch = computed(() => pandocSwitchState(pandocProbe.value, showPandocConvert.value))

const pandocStatus = computed<string>(() => {
  if (probeFailed.value) return t('preferences.commandDetection.failed')
  const { note, path } = pandocSwitch.value
  if (!note) return ''
  return path ? t(note, { path }) : t(note)
})

const pandocDisabled = computed<boolean>(() => pandocSwitch.value.disabled)

const probePandoc = async (): Promise<void> => {
  if (isProbing.value) return
  isProbing.value = true
  probeFailed.value = false
  try {
    pandocProbe.value = await window.electron.ipcRenderer.invoke('mt::pandoc::command')
  } catch {
    probeFailed.value = true
    pandocProbe.value = { command: null }
  } finally {
    isProbing.value = false
  }
}

onMounted(async () => {
  if (show('pandoc')) await probePandoc()
})

const onSelectChange = (type: keyof PreferencesState, value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}

</script>

<style scoped>
.update-check {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  color: var(--editorColor60);
  font-size: 12px;
}

.update-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.update-progress-bar {
  position: relative;
  width: 100%;
  height: 4px;
  overflow: hidden;
  background: var(--editorColor10);
  border-radius: 2px;
}

.update-progress-bar > span {
  display: block;
  height: 100%;
  background: var(--themeColor);
  border-radius: 2px;
  transition: width 0.2s ease;
}

.update-progress-bar.indeterminate > span {
  width: 100% !important;
  opacity: 0.4;
}

.update-progress-meta {
  display: flex;
  gap: 10px;
  color: var(--editorColor60);
  font-size: 12px;
}

.update-note {
  margin: 6px 0 0;
  color: var(--editorColor60);
  font-size: 12px;
}
</style>
