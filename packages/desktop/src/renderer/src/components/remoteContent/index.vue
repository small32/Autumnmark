<template>
  <section
    :aria-label="t(`remoteContent.${kind}`)"
    :class="{ 'remote-content-panel': panel, 'remote-content-panel--community': panel && kind === 'about' }"
  >
    <h3
      v-if="panel && !html"
      class="remote-content-title"
    >
      {{ t(`remoteContent.${kind}`) }}
    </h3>
    <!-- eslint-disable vue/no-v-html -- Markdown is sanitized with a feed-specific allowlist before insertion. -->
    <div
      v-if="html"
      class="remote-markdown"
      tabindex="0"
      @click="openLink"
      @auxclick="openLink"
      v-html="html"
    />
    <!-- eslint-enable vue/no-v-html -->
    <div class="remote-content-status">
      <span role="status">{{ status }}</span>
      <el-button
        text
        size="small"
        :disabled="loading"
        @click="refresh(true)"
      >
        {{ t(failed ? 'remoteContent.retry' : 'remoteContent.refresh') }}
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { renderToStaticHTML } from '@muyajs/core'
import type { RemoteContentKind } from '@shared/types/ipc'
import { useRemoteContentStore } from '@/store/remoteContent'
import { sanitize } from '@/util/dompurify'

const props = defineProps<{ active: boolean; kind: RemoteContentKind; panel?: boolean }>()
const { t } = useI18n()
const feed = useRemoteContentStore()
const snapshot = computed(() => feed.snapshots[props.kind])
const content = computed(() => snapshot.value?.content)
const loading = computed(() => feed.loading[props.kind])
const failed = computed(() => snapshot.value?.status === 'failed')
const webUrl = /^https?:\/\//i

const html = computed(() => {
  if (!content.value) return ''

  const rendered = renderToStaticHTML(content.value.markdown, { texMathDollars: false, sanitize: false })
  return sanitize(rendered, {
    ALLOWED_TAGS: [
      'a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'del',
      'blockquote', 'ul', 'ol', 'li', 'code', 'pre', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: ['href', 'title', 'start', 'src', 'alt'],
    ALLOWED_URI_REGEXP: webUrl,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  })
})

const status = computed(() => {
  if (loading.value) return t('remoteContent.loading')
  if (failed.value) return t(content.value ? 'remoteContent.refreshFailed' : 'remoteContent.loadFailed')
  return ''
})

const refresh = (force: boolean): Promise<void> => feed.refresh(props.kind, force)

const openLink = (event: MouseEvent): void => {
  if (event.type === 'auxclick' && event.button !== 1) return
  if (!(event.target instanceof Element)) return
  const href = event.target.closest('a')?.getAttribute('href')
  if (href && webUrl.test(href)) {
    event.preventDefault()
    void window.electron.shell.openExternal(href)
  }
}

let previouslyOpened = false
watch(() => props.active, (active) => {
  if (active) {
    void refresh(previouslyOpened)
    previouslyOpened = true
  }
}, { immediate: true })
</script>

<style scoped>
.remote-markdown {
  max-height: min(48vh, 440px);
  overflow: auto;
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.remote-markdown :deep(:first-child) {
  margin-top: 0;
}

.remote-markdown :deep(:last-child) {
  margin-bottom: 0;
}

.remote-markdown :deep(a) {
  color: var(--themeColor);
  text-decoration: underline;
}

.remote-markdown :deep(img) {
  max-width: 100%;
}

.remote-markdown :deep(pre) {
  overflow: auto;
}

.remote-content-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}

.remote-content-panel {
  min-width: 0;
  border: 1px solid var(--floatBorderColor);
  border-radius: 10px;
  padding: 12px;
  background: var(--editorColor04);
}

.remote-content-panel .remote-markdown {
  scrollbar-width: thin;
  scrollbar-color: var(--editorColor30) transparent;
  color: var(--editorColor80);
  font-size: 13px;
}

.remote-content-title,
.remote-content-panel .remote-markdown :deep(:is(h1, h2, h3, h4, h5, h6)) {
  margin: 0.8em 0 0.45em;
  color: var(--editorColor80);
  font-size: 1.1em;
  font-weight: 650;
  line-height: 1.4;
}

.remote-content-title,
.remote-content-panel .remote-markdown :deep(> :is(h1, h2, h3):first-child) {
  margin-top: 0;
  font-size: 15px;
}

.remote-content-panel .remote-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.remote-content-panel .remote-markdown :deep(> ul) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 186px), 1fr));
  gap: 0 14px;
  padding: 0;
  list-style: none;
}

.remote-content-panel .remote-markdown :deep(> ul > li) {
  min-width: 0;
  border-top: 1px solid var(--floatBorderColor);
  padding: 7px 0;
}

.remote-content-panel--community .remote-markdown :deep(> ul) {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 118px), 1fr));
  gap: 0 10px;
}

.remote-content-panel--community .remote-markdown {
  max-height: min(26vh, 200px);
}

.remote-content-panel .remote-markdown :deep(blockquote) {
  border-inline-start: 3px solid #ca7848;
  padding: 2px 12px;
  background: var(--floatBgColor);
}

.remote-content-panel .remote-markdown :deep(:is(pre, td, th)) {
  border: 1px solid var(--editorColor10);
  padding: 6px 10px;
}

.remote-content-panel .remote-markdown :deep(:is(pre, th)) {
  background: var(--floatBgColor);
}

.remote-content-panel .remote-markdown :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}

.remote-content-panel .remote-content-status {
  margin-top: 4px;
  color: var(--floatFontColor);
  font-size: 12px;
}

.remote-content-panel .remote-content-status :deep(.el-button) {
  flex-shrink: 0;
}
</style>
