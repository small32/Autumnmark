<template>
  <section
    id="setting-hiddenSidebarPaths"
    class="hidden-files"
    aria-labelledby="hidden-files-title"
  >
    <h6 id="hidden-files-title">
      <span>{{ t('preferences.general.sidebar.hiddenFiles') }}</span>
      <span
        v-if="hiddenPaths.length"
        class="count"
      >{{ hiddenPaths.length }}</span>
    </h6>
    <p class="notes">
      {{ t('preferences.general.sidebar.hiddenFilesNotes') }}
    </p>
    <p
      v-if="!hiddenPaths.length"
      class="notes empty"
    >
      {{ t('preferences.general.sidebar.hiddenFilesEmpty') }}
    </p>
    <template v-else>
      <ul class="hidden-file-list">
        <li
          v-for="pathname in hiddenPaths"
          :key="pathname"
        >
          <div class="file">
            <span
              class="name"
              :title="pathname"
            >{{ basename(pathname) }}</span>
            <span
              class="path"
              :title="pathname"
            >{{ pathname }}</span>
          </div>
          <button
            type="button"
            class="plain-button restore"
            :disabled="busy"
            :aria-label="`${t('preferences.general.sidebar.restore')} ${basename(pathname)}`"
            @click="restore(pathname)"
          >
            {{ t('preferences.general.sidebar.restore') }}
          </button>
        </li>
      </ul>
      <button
        type="button"
        class="plain-button restore-all"
        :disabled="busy"
        @click="restoreAll"
      >
        {{ t('preferences.general.sidebar.restoreAll') }}
      </button>
      <p
        v-if="error"
        class="notes error"
        role="alert"
      >
        {{ t('preferences.general.sidebar.restoreFailed') }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'

const { t } = useI18n()
const preferences = usePreferencesStore()
const hiddenPaths = computed(() => preferences.hiddenSidebarPaths)
const busy = ref(false)
const error = ref(false)

const basename = (pathname: string): string => window.path.basename(pathname) || pathname

const run = async(action: () => Promise<boolean>): Promise<void> => {
  if (busy.value) return
  busy.value = true
  error.value = false
  try {
    error.value = !(await action())
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}

const restore = (pathname: string): Promise<void> =>
  run(() => preferences.RESTORE_SIDEBAR_FILE(pathname))

const restoreAll = (): Promise<void> =>
  run(() => preferences.RESTORE_ALL_SIDEBAR_FILES())
</script>

<style scoped>
.hidden-files {
  margin: 20px 0;
}
.hidden-files h6 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  color: var(--themeColor);
  background: var(--themeColor10);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.empty {
  margin-top: 6px;
}
.hidden-file-list {
  max-height: 240px;
  margin: 8px 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--editorColor10);
  border-radius: 6px;
}
.hidden-file-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
}
.hidden-file-list li + li {
  border-top: 1px solid var(--editorColor10);
}
.file {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.name {
  overflow: hidden;
  color: var(--editorColor80);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path {
  overflow: hidden;
  color: var(--editorColor50);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restore,
.restore-all {
  flex: none;
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--themeColor);
  font-size: 12px;
}
.restore:hover,
.restore-all:hover {
  background: var(--themeColor10);
}
.restore-all {
  margin-top: 2px;
}
.error {
  color: var(--deleteColor);
}
</style>
