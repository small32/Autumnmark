<template>
  <div
    class="pref-category"
    :class="`pref-${category}`"
  >
    <h4 v-if="category !== 'theme'">
      {{ t(`preferences.categories.${category}`) }}
    </h4>
    <update-settings v-if="category === 'updates'" />
    <theme-settings v-if="category === 'theme'" />
    <general-settings
      v-if="generalGroups[category]"
      :key="`general-${category}`"
      :groups="generalGroups[category]"
      embedded
    />
    <editor-settings
      v-if="editorGroups[category]"
      :key="`editor-${category}`"
      :groups="editorGroups[category]"
      embedded
    >
      <template #before-misc>
        <spellchecker-settings
          v-if="category === 'editor'"
          embedded
        />
      </template>
    </editor-settings>
    <image-settings
      v-if="category === 'images'"
      embedded
    />
    <Bool
      v-if="category === 'video'"
      id="setting-embedVideos"
      :description="t('video.embed')"
      :notes="t('video.note')"
      :bool="preferenceStore.embedVideos"
      :on-change="value => preferenceStore.SET_SINGLE_PREFERENCE({ type: 'embedVideos', value })"
    />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { generalGroups, editorGroups, type PreferenceCategoryId } from './categories'
import GeneralSettings from './general/index.vue'
import Bool from './common/bool/index.vue'
import { usePreferencesStore } from '@/store/preferences'

const EditorSettings = defineAsyncComponent(() => import('./editor/index.vue'))
const UpdateSettings = defineAsyncComponent(() => import('./updates/index.vue'))
const ThemeSettings = defineAsyncComponent(() => import('./theme/index.vue'))
const SpellcheckerSettings = defineAsyncComponent(() => import('./spellchecker/index.vue'))
const ImageSettings = defineAsyncComponent(() => import('./image/index.vue'))

defineProps<{ category: PreferenceCategoryId }>()
const { t } = useI18n()
const preferenceStore = usePreferencesStore()
</script>
