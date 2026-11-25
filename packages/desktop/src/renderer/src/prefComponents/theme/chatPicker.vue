<template>
  <div
    class="chat-chooser"
    :style="{ '--chat-picker-anchor': anchor }"
  >
    <button
      class="trigger"
      :disabled="disabled || !items.length"
      :popovertarget="popupId"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="t('studio.conversation')"
      :aria-describedby="selectionId"
      @keydown.down.prevent="popup?.showPopover()"
    >
      <ChatDotRound
        class="trigger-mark"
        aria-hidden="true"
      />
      <span :id="selectionId">{{ current ? title(current) : t('studio.newChat') }}</span>
      <ArrowDown
        class="trigger-chevron"
        aria-hidden="true"
      />
    </button>
    <div
      :id="popupId"
      ref="popup"
      class="options"
      popover="auto"
      role="dialog"
      :aria-label="t('studio.conversation')"
      @toggle="toggle"
      @keydown="moveFocus"
    >
      <ul>
        <li
          v-for="item in items"
          :key="item.id"
        >
          <button
            class="choose"
            :aria-current="item.id === current?.id || undefined"
            :disabled="disabled || selectionLocked"
            :title="title(item)"
            @click="choose(item.id)"
          >
            <Check
              class="selected-mark"
              aria-hidden="true"
            />
            <span>{{ title(item) }}</span>
          </button>
          <button
            class="remove"
            :disabled="disabled || (selectionLocked && item.id === current?.id) || removeDisabled?.(item)"
            :aria-label="t('studio.deleteChat') + ' · ' + title(item)"
            :title="t('studio.deleteChat')"
            @click="emit('remove', item)"
          >
            <Delete aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends { id: string }">
import { ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ChatDotRound, Check, Delete } from '@element-plus/icons-vue'

const props = defineProps<{
  items: T[]
  current?: T
  disabled: boolean
  selectionLocked: boolean
  title: (item: T) => string
  removeDisabled?: (item: T) => boolean
}>()
const emit = defineEmits<{ select: [id: string]; remove: [item: T] }>()
const { t } = useI18n()
const popupId = useId()
const anchor = `--chat-picker-${popupId}`
const selectionId = useId()
const popup = ref<HTMLElement>()
const open = ref(false)
function toggle(event: ToggleEvent): void {
  open.value = event.newState === 'open'
  if (!open.value) return
  const button = popup.value?.querySelector<HTMLButtonElement>('[aria-current="true"]:enabled')
    ?? popup.value?.querySelector<HTMLButtonElement>('button:enabled')
  button?.focus()
}
function choose(id: string): void {
  popup.value?.hidePopover()
  emit('select', id)
}
function moveFocus(event: KeyboardEvent): void {
  const button = event.target
  if (!(button instanceof HTMLButtonElement) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const column = button.classList.contains('remove') ? '.remove' : '.choose'
  const buttons = Array.from(popup.value?.querySelectorAll<HTMLButtonElement>(column + ':enabled') ?? [])
  const index = buttons.indexOf(button)
  if (index < 0) return
  event.preventDefault()
  if (event.key === 'Home') buttons[0].focus()
  else if (event.key === 'End') buttons[buttons.length - 1].focus()
  else buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus()
}
watch(() => props.items.length, count => { if (!count) popup.value?.hidePopover() })
</script>

<style scoped>
.chat-chooser { flex: 1 1 10ch; min-width: 0; }
.chat-chooser button { font: inherit; color: inherit; border-radius: 5px; }
.chat-chooser button:enabled { cursor: pointer; }
.chat-chooser .trigger {
  anchor-name: var(--chat-picker-anchor);
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  padding: 4px 7px;
  border: 0;
  background: transparent;
  text-align: start;
}
.chat-chooser .trigger:enabled:hover { background: var(--editorColor04); }
.chat-chooser .trigger:disabled { opacity: .5; cursor: default; }
.trigger span { flex: 1; }
.trigger-mark, .trigger-chevron { color: var(--editorColor60); }
.trigger .trigger-chevron { width: 11px; height: 11px; }
.trigger span, .choose span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
svg { width: 14px; height: 14px; flex-shrink: 0; }
.options {
  inset: auto;
  position: fixed;
  position-anchor: var(--chat-picker-anchor);
  top: anchor(bottom);
  left: anchor(left);
  width: anchor-size(width);
  position-try-fallbacks: flip-block;
  box-sizing: border-box;
  max-height: min(320px, 50vh);
  overflow: auto;
  margin: 4px 0;
  padding: 4px;
  border: 1px solid var(--studio-outline, var(--editorColor10));
  border-radius: 8px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  box-shadow: 0 4px 14px var(--editorColor10);
}
ul { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 34px;
  padding-inline-end: 2px;
  border-radius: 5px;
}
li:is(:hover, :focus-within) { background: var(--editorColor04); }
li:has(.choose[aria-current=true]) { background: var(--themeColor10); }
.options .choose {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: 7px;
  padding: 4px 7px;
  border: 0;
  background: transparent;
  text-align: start;
}
.selected-mark { visibility: hidden; color: var(--themeColor); }
.choose[aria-current=true] .selected-mark { visibility: visible; }
.options .remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--editorColor60);
}
.options .remove:enabled:is(:hover, :focus-visible) {
  color: color-mix(in srgb, var(--deleteColor) 80%, var(--editorColor));
  background: color-mix(in srgb, var(--deleteColor) 12%, transparent);
}
.options button:disabled { cursor: default; }
.options .remove:disabled { opacity: .45; }
@media (pointer: coarse) {
  li { min-height: 44px; }
  .options .remove { width: 44px; height: 44px; }
}
</style>
