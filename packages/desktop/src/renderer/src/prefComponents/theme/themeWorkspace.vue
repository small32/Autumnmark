<template>
  <studio
    :key="active.key"
    ref="studio"
    :entry="active"
    :saved-theme="savedThemes.find(theme => theme.id === active.draft.id)"
    :applied-id="preferences.theme"
    :switching="switching"
    :workspace-error="workspaceError"
    @saved="themeSaved"
    @imported="importDraft"
  >
    <template #library="{ theme, disabled }">
      <theme-library
        :drafts="draftItems"
        :saved="savedItems"
        :current-id="theme.id"
        :current-base="theme.base"
        :applied-id="preferences.theme"
        :disabled="disabled"
        @open="refreshDrafts"
        @select="selectTheme"
        @create="createDraft"
        @remove="deleteTheme"
      />
    </template>
  </studio>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { themeBaseId } from 'common/theme'
import { localThemeList, maxThemeNameLength, themeBases, type LocalTheme } from '@shared/localTheme'
import type { UserPreferences } from '@shared/types/preferences'
import { addThemeStyle } from '@/util/theme'
import { localThemeCss } from '@/util/themeOverrides'
import Studio from './studio.vue'
import ThemeLibrary from './themeLibrary.vue'
import { themeLabel } from './config'
import { editableTheme, listThemeDrafts, newThemeDraft, readThemeDraft, removeThemeDraft, themeDraftPrefix,
  type ThemeDraftEntry, type ThemeLibraryItem } from './themeDrafts'

const props = defineProps<{ initial: string; editing: boolean; initialPreferences: UserPreferences }>()
const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const activeKey = 'autumnmark.theme-studio.active-draft'
const preferences = shallowRef(props.initialPreferences)
const savedThemes = computed(() => localThemeList(preferences.value.localThemes))
const drafts = shallowRef(listThemeDrafts())
const studio = ref<InstanceType<typeof Studio>>()
const switching = ref(false)
const workspaceError = ref('')
const launchDrafts = new Map<string, string>()
let navigation = Promise.resolve()
let disposed = false

function refreshDrafts(): void {
  drafts.value = listThemeDrafts()
}

function savedEntry(theme: LocalTheme): ThemeDraftEntry {
  const preferred = themeDraftPrefix + 'edit.' + theme.id
  const stored = readThemeDraft(preferred)
  if (stored?.draft.id === theme.id) return stored
  const existing = drafts.value.find(entry => entry.draft.id === theme.id)
  if (existing) return existing
  const key = stored ? preferred + '.' + crypto.randomUUID() : preferred
  return { key, draft: editableTheme(theme) }
}

function landingDraft(id: string, editing: boolean): ThemeDraftEntry {
  const theme = savedThemes.value.find(item => item.id === id)
  if (editing && theme) return savedEntry(theme)
  const defaultKey = themeDraftPrefix + 'new.' + id
  const key = launchDrafts.get(id) ?? defaultKey
  const existing = readThemeDraft(key)
  if (existing && !savedThemes.value.some(item => item.id === existing.draft.id)) return existing
  const base = themeBaseId(id)
  const name = ((theme?.name ?? themeLabel(base)) + ' · ' + t('studio.copy')).slice(0, maxThemeNameLength)
  const entry = newThemeDraft(name, base, theme, existing ? undefined : key)
  launchDrafts.set(id, entry.key)
  return entry
}

const initialKey = sessionStorage.getItem(activeKey) ?? ''
const temporaryDraft = readThemeDraft(initialKey, sessionStorage)
const active = shallowRef(readThemeDraft(initialKey) ?? temporaryDraft ?? landingDraft(props.initial, props.editing))
try {
  if (!temporaryDraft && !readThemeDraft(active.value.key)) {
    localStorage.setItem(active.value.key, JSON.stringify(active.value.draft))
  }
  sessionStorage.setItem(activeKey, active.value.key)
  refreshDrafts()
} catch { workspaceError.value = t('studio.storageError') }

const draftItems = computed<ThemeLibraryItem[]>(() => drafts.value
  .filter(entry => !savedThemes.value.some(theme => theme.id === entry.draft.id))
  .map(({ key, draft }) => ({ key, id: draft.id, name: draft.name, base: draft.base, saved: false })))
const savedItems = computed<ThemeLibraryItem[]>(() => savedThemes.value.map(theme => {
  const { draft } = savedEntry(theme)
  return { key: theme.id, id: theme.id, name: draft.name, base: theme.base, saved: true,
    changed: draft.name.trim() !== theme.name || localThemeCss(draft) !== localThemeCss(theme) }
}))

function navigate(action: () => Promise<void>, failure: string): void {
  navigation = navigation.then(async() => {
    if (disposed) return
    switching.value = true
    workspaceError.value = ''
    try {
      await action()
    } catch {
      workspaceError.value = t(failure)
      studio.value?.resumeDraft()
    } finally {
      switching.value = false
    }
  })
}

function activate(entry: ThemeDraftEntry): void {
  const previousKey = active.value.key
  sessionStorage.setItem(activeKey, entry.key)
  active.value = entry
  sessionStorage.removeItem(previousKey)
}

function switchTo(resolveEntry: () => ThemeDraftEntry | undefined, sample?: string | null, restore?: LocalTheme): void {
  navigate(async() => {
    const entry = resolveEntry()
    if (!entry || active.value.key === entry.key) return
    await studio.value?.prepareToLeave()
    if (disposed) return
    const stored = readThemeDraft(entry.key)
    if (!stored) {
      if (sample != null) localStorage.setItem(entry.key + '.sample', sample)
      localStorage.setItem(entry.key, JSON.stringify(entry.draft))
    }
    if (restore) localStorage.setItem(active.value.key, JSON.stringify(editableTheme(restore)))
    activate(stored ?? entry)
    refreshDrafts()
    await nextTick()
  }, 'themeLibrary.switchFailed')
}

function selectTheme(item: ThemeLibraryItem): void {
  switchTo(() => {
    if (!item.saved) return readThemeDraft(item.key)
    const saved = savedThemes.value.find(theme => theme.id === item.id)
    if (saved) return savedEntry(saved)
  })
}

function createDraft(name: string, base: string): void {
  if (base === 'current') {
    const source = studio.value?.copyDraft()
    if (source) switchTo(() => newThemeDraft(name, source.theme.base, source.theme), source.sample)
  } else if (themeBases.includes(base)) switchTo(() => newThemeDraft(name, base))
}

function importDraft(theme: LocalTheme): void {
  switchTo(() => newThemeDraft(theme.name, theme.base, theme))
}

function deleteTheme(item: ThemeLibraryItem): void {
  navigate(async() => {
    const deletingActive = active.value.draft.id === item.id
    if (deletingActive) await studio.value?.prepareToLeave()
    if (disposed) return

    const entries = listThemeDrafts()
    const deleted = entries.filter(entry => entry.draft.id === item.id)
    if (item.saved) {
      const next = await ipc.invoke('mt::theme::delete', item.id)
      if (!next) throw new Error('themeStorageUnavailable')
      updatePreferences(next)
    }

    if (deletingActive) {
      const saved = savedThemes.value[0]
      let next = entries.find(entry => entry.draft.id !== item.id &&
        !savedThemes.value.some(theme => theme.id === entry.draft.id))
      if (!next && saved) {
        next = savedEntry(saved)
        if (!readThemeDraft(next.key)) localStorage.setItem(next.key, JSON.stringify(next.draft))
      }
      if (!next) {
        next = newThemeDraft(t('themeLibrary.defaultName'), themeBaseId(preferences.value.theme))
        // The editor stays usable with an empty library until an edit creates a draft.
        sessionStorage.setItem(next.key, JSON.stringify(next.draft))
      }
      activate(next)
      await nextTick()
    }

    for (const { key } of deleted) removeThemeDraft(key)
    refreshDrafts()
  }, 'themeLibrary.deleteFailed')
}

function updatePreferences(next: UserPreferences): void {
  const baseChanged = themeBaseId(next.theme) !== themeBaseId(preferences.value.theme)
  preferences.value = next
  if (baseChanged) addThemeStyle(themeBaseId(next.theme))
}

async function themeSaved(theme: LocalTheme, apply: boolean): Promise<void> {
  const entry = readThemeDraft(active.value.key)
  if (entry) active.value = entry
  if (theme.id !== active.value.draft.id) {
    const original = savedThemes.value.find(item => item.id === active.value.draft.id)
    const sample = studio.value?.copyDraft().sample
    switchTo(() => ({ key: themeDraftPrefix + 'edit.' + theme.id, draft: editableTheme(theme) }), sample, original)
  }
  const latest = preferences.value
  updatePreferences({ ...latest,
    localThemes: [...savedThemes.value.filter(item => item.id !== theme.id), theme],
    theme: apply && !latest.followSystemTheme ? theme.id : latest.theme
  })
  refreshDrafts()
  try { updatePreferences(await ipc.invoke('mt::preferences::get')) }
  catch { workspaceError.value = t('studio.storageError') }
}

const unsubscribePreferences = ipc.on('mt::preferences::changed', (_event, next) => updatePreferences(next))
const unsubscribeOpen = ipc.on('mt::theme::show', (_event, id, editing) => {
  refreshDrafts()
  switchTo(() => landingDraft(id, editing))
})
onBeforeUnmount(() => {
  disposed = true
  unsubscribePreferences()
  unsubscribeOpen()
})
</script>
