<template>
  <el-dialog
    :model-value="updates.visible"
    :title="t('updates.title')"
    class="update-dialog"
    width="min(420px, calc(100vw - 32px))"
    align-center
    append-to-body
    @update:model-value="updates.hide"
  >
    <template #header="{ titleId }">
      <div class="update-header">
        <el-icon
          class="update-icon"
          :size="22"
        >
          <Download />
        </el-icon>
        <h2 :id="titleId">
          {{ t('updates.title') }}
        </h2>
      </div>
    </template>
    <div class="update-status">
      <span role="status">{{ status }}</span>
      <strong v-if="percent !== null">{{ percent }}%</strong>
    </div>
    <div
      v-if="busy || state.phase === 'ready' || state.phase === 'installing'"
      class="update-meter"
      :class="{ indeterminate: percent === null && state.phase !== 'ready' }"
      role="progressbar"
      :aria-label="t('updates.title')"
      :aria-valuenow="percent ?? (state.phase === 'ready' ? 100 : undefined)"
    >
      <span :style="{ width: (percent ?? 100) + '%' }" />
    </div>
    <div
      v-if="progress"
      class="update-details"
    >
      <span>
        {{ size.format(progress.transferred / 1e6) }}
        <template v-if="progress.total > 0"> / {{ size.format(progress.total / 1e6) }}</template>
      </span>
      <span v-if="progress.bytesPerSecond > 0 && !waiting && percent !== 100">
        {{ speed.format(progress.bytesPerSecond / 1e6) }}
      </span>
    </div>
    <p
      v-if="waiting"
      class="update-hint"
      role="status"
    >
      {{ t('updates.waiting') }}
    </p>
    <template #footer>
      <el-button @click="updates.hide">
        {{ busy ? t('updates.background') : state.phase === 'ready' ? t('updates.later') : t('titleBar.close') }}
      </el-button>
      <el-button
        v-if="releaseVersion"
        @click="updates.openRelease"
      >
        {{ t('updates.openRelease') }}
      </el-button>
      <el-button
        v-if="canCancel"
        @click="updates.cancel"
      >
        {{ t('updates.cancel') }}
      </el-button>
      <el-button
        v-else-if="canDownload"
        type="primary"
        @click="updates.download"
      >
        {{ t('updates.download') }}
      </el-button>
      <el-button
        v-if="canInstall"
        type="primary"
        @click="updates.install"
      >
        {{ t('updates.install') }}
      </el-button>
      <el-button
        v-else-if="state.phase === 'error'"
        type="primary"
        @click="updates.retry"
      >
        {{ t('updates.retry') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Download } from '@element-plus/icons-vue'
import { useAutoUpdatesStore } from '@/store/autoUpdates'

const updates = useAutoUpdatesStore()
const stopListening = updates.listen()
onBeforeUnmount(stopListening)
const { t, locale } = useI18n()
const { state, progress, percent, status, releaseVersion, onlineEnabled } = storeToRefs(updates)
const busy = computed(() => ['checking', 'downloading'].includes(state.value.phase))
const size = computed(() => new Intl.NumberFormat(locale.value, {
  style: 'unit', unit: 'megabyte', maximumFractionDigits: 1
}))
const speed = computed(() => new Intl.NumberFormat(locale.value, {
  style: 'unit', unit: 'megabyte-per-second', maximumFractionDigits: 2
}))
const installable = window.electron.canInstallInPlace === true
const canDownload = computed(() => installable && onlineEnabled.value && state.value.phase === 'available')
const canCancel = computed(() => state.value.phase === 'downloading')
const canInstall = computed(() => installable && onlineEnabled.value && (
  state.value.phase === 'ready' ||
  (state.value.phase === 'error' && state.value.stage === 'install')
))
const waiting = ref(false)
watch([() => updates.visible, () => state.value.phase, () => progress.value?.transferred], (_, __, cleanUp) => {
  waiting.value = false
  if (!updates.visible || !busy.value || percent.value === 100) return
  const timer = setTimeout(() => { waiting.value = true }, 15000)
  cleanUp(() => clearTimeout(timer))
}, { immediate: true })
</script>

<style scoped>
:global(.el-dialog.update-dialog) {
  --el-dialog-padding-primary: 24px;
  border-radius: 16px;
}

.update-header, .update-status, .update-details {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--themeColor);
  background: var(--themeColor10);
}

.update-header h2 {
  margin: 0;
  color: var(--editorColor);
  font-size: 18px;
  font-weight: 600;
}

.update-status, .update-details {
  justify-content: space-between;
  color: var(--editorColor80);
  font-variant-numeric: tabular-nums;
}

.update-meter {
  overflow: hidden;
  height: 7px;
  margin-top: 14px;
  border-radius: 8px;
  background: var(--editorColor10);
}

.update-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--themeColor);
  transition: width 240ms ease-out;
}

.update-meter.indeterminate > span {
  max-width: 35%;
  animation: update-pulse 1.6s ease-in-out infinite alternate;
}

@keyframes update-pulse {
  to { transform: translateX(185%); }
}

.update-details, .update-hint {
  margin: 8px 0 0;
  color: var(--editorColor60);
  font-size: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .update-meter > span { transition: none; }
  .update-meter.indeterminate > span { animation: none; }
}
</style>
