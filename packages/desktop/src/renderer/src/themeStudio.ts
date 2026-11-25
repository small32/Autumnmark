import { createApp } from 'vue'
import { i18n, setLanguage, t } from './i18n'
import ThemeWorkspace from './prefComponents/theme/themeWorkspace.vue'
import { themeBaseId } from 'common/theme'
import { addThemeStyle } from './util/theme'
import './assets/styles/index.css'

const prefs = await window.electron.ipcRenderer.invoke('mt::preferences::get')
const params = new URLSearchParams(location.search)
const initial = params.get('initial') ?? prefs.theme
await setLanguage(prefs.language || navigator.language)
document.title = t('studio.title') + ' · AutumnMark+'
addThemeStyle(themeBaseId(prefs.theme))
createApp(ThemeWorkspace, { initial, editing: params.get('editing') === 'true', initialPreferences: prefs })
  .use(i18n).mount('#app')
window.electron.ipcRenderer.send('mt::theme::ready')
