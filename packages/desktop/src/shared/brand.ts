import { version } from '../../package.json'

export const APP_NAME = 'Antumnmark+'
export const APP_ID = 'io.github.autumn-one.autumnmark'
export const APP_PROFILE_NAME = 'autumnmark'
export const GITHUB_REPO_URL = 'https://github.com/small32/Autumnmark'
const docsRef = /^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : 'develop'
export const END_USER_DOCS_URL = `${GITHUB_REPO_URL}/blob/${docsRef}/packages/website/content/docs/end-user`
