<template>
  <section
    class="chat-onboarding"
    :aria-labelledby="headingId"
  >
    <header>
      <span class="intro-icon"><MagicStick aria-hidden="true" /></span>
      <h2 :id="headingId">
        {{ t('documentChat.onboarding.title') }}
      </h2>
      <p
        v-if="modelState === 'loading'"
        role="status"
      >
        {{ t('documentChat.onboarding.loadingModels') }}
      </p>
      <p
        v-else-if="modelState === 'failed'"
        class="feedback-error"
        role="alert"
      >
        {{ t('ai.loadFailed') }}
      </p>
      <p v-else>
        {{ t('ai.empty') }}
      </p>
    </header>
    <div class="route">
      <h3>{{ t('documentChat.onboarding.builtIn') }}</h3>
      <p>{{ t('documentChat.onboarding.builtInHint') }}</p>
      <empty-state-button
        :label="t('documentChat.configure')"
        @click="ipc.send('mt::open-setting-window', 'ai')"
      />
      <button
        v-if="modelState === 'failed'"
        type="button"
        @click="emit('retry')"
      >
        {{ t('documentChat.onboarding.retry') }}
      </button>
    </div>
    <div class="route">
      <h3>{{ t('documentChat.onboarding.externalClient') }}</h3>
      <p>{{ t('documentChat.onboarding.externalHint') }}</p>
      <button
        ref="externalButton"
        class="external-button"
        type="button"
        aria-haspopup="dialog"
        @click="external = true"
      >
        {{ t('documentChat.onboarding.useExternal') }}
        <ArrowRight aria-hidden="true" />
      </button>
    </div>
    <teleport to="body">
      <external-ai-skill-dialog
        v-if="external"
        @close="closeExternal"
      />
    </teleport>
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import { ArrowRight, MagicStick } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import EmptyStateButton from '@/components/emptyStateButton.vue'
import ExternalAiSkillDialog from './externalAiSkillDialog.vue'

defineProps<{ modelState: 'loading' | 'ready' | 'failed' }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const headingId = useId()
const external = ref(false)
const externalButton = ref<HTMLButtonElement>()

async function closeExternal(): Promise<void> {
  external.value = false
  await nextTick()
  externalButton.value?.focus()
}
</script>

<style scoped>
.chat-onboarding {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  min-height: 0;
  overflow: auto;
  padding: 16px 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
header, .route {
  display: grid;
  gap: 5px;
}
.route {
  padding: 10px;
  border: 1px solid var(--sideBarBorderColor);
  border-radius: 7px;
  background: var(--editorBgColor);
}
h2, h3, p { margin: 0; }
h2, h3 { color: var(--editorColor); }
h2 { font-size: 16px; }
h3 { font-size: 13px; }
.intro-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-bottom: 3px;
  border-radius: 6px;
  color: var(--themeColor);
  background: var(--themeColor10);
}
svg { width: 14px; height: 14px; flex: none; }
.intro-icon svg { width: 17px; height: 17px; }
.route :deep(.empty-state-button) {
  height: auto;
  min-height: 30px;
  margin: 2px 0 0;
  padding: 5px 8px;
  font-size: inherit;
  white-space: normal;
}
button:not(.empty-state-button) {
  box-sizing: border-box;
  min-height: 29px;
  min-width: 0;
  padding: 4px 7px;
  color: inherit;
  font: inherit;
  background: var(--editorBgColor);
  border: 1px solid var(--sideBarBorderColor);
  border-radius: 5px;
}
button:enabled { cursor: pointer; }
button:not(.empty-state-button):enabled:hover { border-color: var(--themeColor); }
.external-button { display: flex; align-items: center; justify-content: center; gap: 5px; }
.feedback-error { color: var(--deleteColor); }
</style>
