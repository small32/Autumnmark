<template>
  <el-dialog
    :model-value="true"
    append-to-body
    align-center
    width="min(970px, calc(100vw - 24px))"
    class="catalog-theme-preview"
    :title="t('studio.preview')"
    :show-close="!busy"
    :close-on-press-escape="!busy"
    :close-on-click-modal="!busy"
    @close="close"
  >
    <div class="preview-toolbar">
      <div class="preview-controls">
        <el-select
          class="preview-picker"
          :model-value="choice.key"
          :aria-label="t('preferences.theme.chooseTheme')"
          :disabled="busy"
          filterable
          :show-arrow="false"
          popper-class="pref-dropdown"
          @change="emit('select', $event)"
        >
          <el-option
            v-for="option in choices"
            :key="option.key"
            :label="option.name"
            :value="option.key"
          />
        </el-select>
        <div
          class="preview-modes"
          role="group"
          :aria-label="t('studio.preview')"
        >
          <el-button
            size="small"
            :aria-pressed="!source"
            @click="source = false"
          >
            {{ t('studio.document') }}
          </el-button>
          <el-button
            size="small"
            :aria-pressed="source"
            @click="source = true"
          >
            {{ t('studio.source') }}
          </el-button>
        </div>
      </div>
      <el-button
        :icon="Grid"
        :aria-pressed="comparison"
        :disabled="!canCompare"
        @click="compare = !compare"
      >
        {{ t('preferences.theme.compare') }}
      </el-button>
    </div>
    <div
      class="preview-boards"
      :class="{ 'is-comparing': comparison }"
    >
      <figure v-if="comparison">
        <figcaption><strong>{{ currentName }}</strong> · {{ t('preferences.theme.currentTheme') }}</figcaption>
        <div
          class="preview-board"
          :style="currentStyle"
        >
          <preview-frame
            :theme="current"
            :title="currentName"
            :markdown="sample.markdown"
            :filename="sample.filename"
            :sidebar="t('studio.sample')"
            :source="source"
            @dismiss="close"
          />
        </div>
      </figure>
      <figure>
        <figcaption v-if="comparison">
          <strong>{{ choice.name }}</strong> · {{ t('preferences.theme.previewing') }}
        </figcaption>
        <div
          class="preview-board"
          :style="candidateStyle"
        >
          <preview-frame
            v-if="candidate !== undefined"
            :theme="candidate"
            :title="choice.name"
            :markdown="sample.markdown"
            :filename="sample.filename"
            :sidebar="t('studio.sample')"
            :source="source"
            @dismiss="close"
          />
          <div
            v-else
            class="preview-message"
          >
            <p
              v-if="status === 'loading'"
              role="status"
            >
              {{ t('preferences.theme.previewLoading') }}
            </p>
            <template v-else>
              <p role="alert">
                {{ t('preferences.theme.previewFailed') }}
              </p>
              <el-button
                size="small"
                @click="loadPreview"
              >
                {{ t('preferences.theme.previewRetry') }}
              </el-button>
              <img
                v-if="choice.image"
                :src="choice.image"
                :alt="choice.name"
                referrerpolicy="no-referrer"
              >
            </template>
          </div>
        </div>
      </figure>
    </div>
    <p
      v-if="error"
      class="preview-error"
      role="alert"
    >
      {{ error }}
    </p>
    <template #footer>
      <div class="preview-footer">
        <span>{{ t('preferences.theme.currentTheme') }} · {{ currentName }}</span>
        <div class="preview-controls">
          <el-button
            :disabled="busy"
            @click="close"
          >
            {{ t('dialog.close') }}
          </el-button>
          <el-button
            type="primary"
            :loading="busy"
            :disabled="actionDisabled || candidate === undefined"
            @click="emit('apply')"
          >
            {{ actionLabel }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Grid } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import type { CatalogThemeSource, LocalTheme } from '@shared/localTheme'
import type { ThemeChoiceItem } from './config'
import PreviewFrame from './previewFrame.vue'
import { themePreviewStyle } from './previews'
import { themeSample } from './sample'
import '../common/dropdownAppearance.css'

const props = defineProps<{
  choices: ThemeChoiceItem[]
  choice: ThemeChoiceItem
  current: LocalTheme | string
  currentName: string
  release?: CatalogThemeSource
  actionLabel: string
  actionDisabled: boolean
  busy: boolean
  canCompare: boolean
  error: string
}>()
const emit = defineEmits<{ close: []; select: [key: string]; apply: [] }>()
const { t, locale } = useI18n()
const sample = computed(() => themeSample(locale.value))
const source = ref(false)
const compare = ref(false)
const comparison = computed(() => compare.value && props.canCompare)
const remoteTheme = shallowRef<LocalTheme>()
const status = ref<'loading' | 'failed' | 'ready'>('ready')
const candidate = computed(() => props.release ? remoteTheme.value : props.choice.local ?? props.choice.base)
const currentStyle = computed(() => typeof props.current === 'string' ? themePreviewStyle(props.current) :
  themePreviewStyle(props.current.base, props.current))
const candidateStyle = computed(() => themePreviewStyle(props.choice.base,
  typeof candidate.value === 'object' ? candidate.value : undefined))
let requestId = 0

watch(() => props.canCompare, available => { if (!available) compare.value = false })
watch([() => props.choice.key, () => props.release?.revision], loadPreview, { immediate: true })
onMounted(() => document.addEventListener('keydown', closeOnSpace, true))
onBeforeUnmount(() => {
  requestId++
  document.removeEventListener('keydown', closeOnSpace, true)
})

async function loadPreview(): Promise<void> {
  const pendingId = ++requestId
  const release = props.release
  remoteTheme.value = undefined
  status.value = release ? 'loading' : 'ready'
  if (!release) return
  try {
    const theme = await window.electron.ipcRenderer.invoke('mt::theme::preview', release.id, release.revision)
    if (pendingId !== requestId) return
    remoteTheme.value = theme
    status.value = 'ready'
  } catch {
    if (pendingId === requestId) status.value = 'failed'
  }
}

function close(): void {
  if (!props.busy) emit('close')
}

function closeOnSpace(event: KeyboardEvent): void {
  if (event.key !== ' ' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable ||
    target.closest('textarea, select, input:not([role="combobox"]), [role="combobox"][aria-expanded="true"]'))) return
  event.preventDefault()
  event.stopPropagation()
  close()
}
</script>

<style scoped>
:global(.catalog-theme-preview) {
  --el-dialog-bg-color: var(--floatBgColor);
  --el-text-color-primary: var(--editorColor);
  --el-text-color-regular: var(--editorColor);
  --el-border-color: var(--floatBorderColor);
  --el-fill-color-blank: var(--floatBgColor);
  --el-color-primary: var(--buttonPrimaryBgColor);
  max-height: calc(100vh - 24px);
  overflow-y: auto;
}
.preview-toolbar, .preview-footer {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px;
}
.preview-toolbar { margin-bottom: 12px; }
.preview-toolbar > .preview-controls { flex: 1 1 400px; }
.preview-controls { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; gap: 7px; }
.preview-picker { width: 230px; max-width: 100%; }
.preview-modes { display: flex; flex-wrap: wrap; gap: 3px; }
.preview-modes .el-button + .el-button, .preview-controls .el-button + .el-button { margin-left: 0; }
.preview-modes [aria-pressed='true'], .preview-toolbar [aria-pressed='true'] {
  border-color: var(--themeColor);
  background: var(--themeColor10);
}
.preview-boards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.preview-boards.is-comparing { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.preview-boards figure { min-width: 0; margin: 0; }
.preview-boards figcaption { margin-bottom: 5px; font-size: 12px; color: var(--editorColor80); }
.preview-board { border: 1px solid var(--floatBorderColor); border-radius: 7px; overflow: hidden; }
.preview-message { min-height: clamp(260px, 55vh, 490px); text-align: center; padding: 12px; }
.preview-message img { display: block; max-width: 100%; max-height: 35vh; object-fit: contain; margin: 10px auto 0; }
.preview-footer { font-size: 12px; color: var(--editorColor80); }
.preview-error { color: var(--deleteColor); margin: 7px 0 0; }
@media (max-width: 650px) {
  .preview-boards.is-comparing { grid-template-columns: minmax(0, 1fr); }
}
</style>
