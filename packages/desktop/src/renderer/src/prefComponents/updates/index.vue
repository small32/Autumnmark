<template>
  <div class="updates-settings">
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { preferenceLabel, preferenceNotes } from '@/prefComponents/registry'
import { usePreferencesStore } from '@/store/preferences'
import { useAutoUpdatesStore } from '@/store/autoUpdates'
import Bool from '../common/bool/index.vue'

const { t, locale } = useI18n()
const preferenceStore = usePreferencesStore()
const { checkUpdatesOnStartup, onlineUpdateEnabled } = storeToRefs(preferenceStore)

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
const onSelectChange = (type: 'checkUpdatesOnStartup' | 'onlineUpdateEnabled', value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}
</script>

<style scoped>
.updates-settings {
  font-size: 14px;
  color: var(--editorColor);
  margin-top: -8px;
}

.update-check {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  color: var(--editorColor60);
  font-size: 12px;
}

.update-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 16px;
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
  margin: 12px 0 0;
  color: var(--editorColor60);
  font-size: 12px;
}
</style>
