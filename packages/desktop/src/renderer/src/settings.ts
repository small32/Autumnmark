import {
  ElAutocomplete, ElButton, ElConfigProvider, ElDialog, ElIcon, ElInput, ElInputTag,
  ElOption, ElPopover, ElScrollbar, ElSelect, ElSlider, ElSwitch, ElTooltip
} from 'element-plus'
import 'element-plus/dist/index.css'
import '@muyajs/core/assets/styles/index.css'
import './assets/styles/index.css'
import bootstrapRenderer from './bootstrap'
import { createRenderer } from './createRenderer'
import routes from './router'
import { usePreferencesStore } from './store/preferences'

bootstrapRenderer()
const app = createRenderer(routes(window.marktext?.env?.type))
for (const component of [
  ElAutocomplete, ElButton, ElConfigProvider, ElDialog, ElIcon, ElInput, ElInputTag,
  ElOption, ElPopover, ElScrollbar, ElSelect, ElSlider, ElSwitch, ElTooltip
]) {
  app.use(component)
}
const preferences = usePreferencesStore()
preferences.LISTEN_FOR_USER_PREFERENCE()
const initial = await window.electron.ipcRenderer.invoke('mt::preferences::get')
// A broadcast may have arrived while the snapshot was in flight; it is newer,
// so it must not be rolled back by the snapshot.
await preferences.SET_USER_PREFERENCE({ ...initial }, { skipBroadcasted: true })
app.mount('#app')
