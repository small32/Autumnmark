import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { themeBaseId } from 'common/theme'
import { localThemeList, maxThemeNameLength } from '@shared/localTheme'
import { usePreferencesStore } from '@/store/preferences'
import { themeLabel } from '@/prefComponents/theme/config'
import { editableTheme, listThemeDrafts, newThemeDraft, readThemeDraft, themeDraftPrefix, type ThemeDraftEntry } from '@/prefComponents/theme/themeDrafts'

export function useEditorThemeTarget() {
  const { t } = useI18n()
  const { theme, localThemes } = storeToRefs(usePreferencesStore())
  const library = computed(() => localThemeList(localThemes.value))
  const source = computed(() => library.value.find(item => item.id === theme.value) ?? null)
  const copies = new Map<string, ThemeDraftEntry>()

  const target = computed<ThemeDraftEntry>(() => {
    const id = theme.value
    const local = source.value
    if (local && !local.catalog) {
      const preferred = themeDraftPrefix + 'edit.' + id
      const existing = listThemeDrafts().find(item => item.draft.id === id)
      return { key: existing?.key ?? preferred, draft: editableTheme(local) }
    }
    const base = themeBaseId(id)
    const key = themeDraftPrefix + 'new.' + id
    const stored = copies.get(id) ?? readThemeDraft(key)
    const installed = stored && library.value.some(item => item.id === stored.draft.id)
    if (stored && !installed && stored.draft.base === base) {
      return stored
    }
    const name = `${local?.name ?? themeLabel(id)} · ${t('studio.copy')}`.slice(0, maxThemeNameLength)
    const entry = newThemeDraft(name, base, local ?? undefined, stored ? undefined : key)
    copies.set(id, entry)
    return entry
  })
  return { theme, source, target }
}
