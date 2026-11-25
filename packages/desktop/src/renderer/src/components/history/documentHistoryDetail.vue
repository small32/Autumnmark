<template>
  <section
    class="document-detail"
    :aria-label="t('history.documentChanges')"
  >
    <div class="document-detail-body">
      <p>{{ t('history.documentChanges') }}</p>
      <h3 aria-live="polite">
        {{ entry.prompt }}
      </h3>
      <div
        v-for="change in entry.changes"
        :key="change.start"
        class="markdown-change"
      >
        <del v-if="change.before">{{ change.before }}</del>
        <ins v-if="change.text">{{ change.text }}</ins>
      </div>
    </div>
    <footer>
      <span v-if="entry.reverted">{{ t('documentChat.changesReverted') }}</span>
      <button
        type="button"
        @click="emit('conversation')"
      >
        {{ t('history.viewConversation') }}
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DocumentChatHistoryEntry } from '@shared/documentChat'

defineProps<{ entry: DocumentChatHistoryEntry }>()
const emit = defineEmits<{ conversation: [] }>()
const { t } = useI18n()
</script>

<style scoped>
.document-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.document-detail-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
  overflow-wrap: anywhere;
}
.document-detail-body p { margin: 0; color: var(--studio-muted); font-size: 12px; }
.document-detail-body h3 { margin: 8px 0 12px; font-size: 16px; }
.markdown-change { display: grid; gap: 2px; margin-top: 8px; white-space: pre-wrap; }
.markdown-change > * { padding: 3px 6px; border-radius: 3px; }
.markdown-change del { background: color-mix(in srgb, var(--deleteColor, currentColor) 14%, transparent); }
.markdown-change ins { background: color-mix(in srgb, var(--themeColor) 12%, transparent); text-decoration: none; }
.document-detail footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 9px 12px;
  border-top: 1px solid var(--studio-divider);
  color: var(--studio-muted);
}
.document-detail button {
  margin-inline-start: auto;
  padding: 5px 8px;
  border: 1px solid var(--studio-outline);
  border-radius: 6px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  font: inherit;
  cursor: pointer;
}
.document-detail button:hover { background: var(--studio-hover); }
.document-detail button:focus-visible { outline: 2px solid var(--themeColor); outline-offset: 1px; }
</style>
