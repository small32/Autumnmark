<template>
  <div class="about-dialog">
    <el-dialog
      v-model="showAboutDialog"
      :modal="true"
      custom-class="ag-dialog-table"
      width="min(460px, calc(100vw - 32px))"
      :title="name"
    >
      <template #header>
        <img
          class="logo"
          :src="AppLogo"
          alt=""
        >
      </template>
      <el-row>
        <el-col :span="24">
          <h3 class="title">
            {{ name }}
          </h3>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ store.appVersion }}
          </div>
        </el-col>
        <el-col :span="24">
          <a
            class="repo-link"
            :href="repositoryUrl"
            @click.prevent="openRepository"
          >{{ repositoryUrl }}</a>
        </el-col>
      </el-row>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useMainStore } from '@/store'
import bus from '../../bus'
import AppLogo from '../../assets/images/logo.png'
import { APP_NAME, GITHUB_REPO_URL } from '@shared/brand'

const name = `${APP_NAME} · 秋笺`
const repositoryUrl = GITHUB_REPO_URL
const showAboutDialog = ref(false)

const store = useMainStore()

const openRepository = (): void => {
  window.electron.shell.openExternal(repositoryUrl)
}

const showDialog = () => {
  showAboutDialog.value = true
  bus.emit('editor-blur')
}

onMounted(() => {
  bus.on('aboutDialog', showDialog)
})

onBeforeUnmount(() => {
  bus.off('aboutDialog', showDialog)
})
</script>

<style>
.about-dialog el-row,
.about-dialog el-col {
  display: block;
}

.about-dialog img.logo {
  width: 80px;
  height: 80px;
  display: inherit;
  margin: 0 auto;
}

.about-dialog .title,
.about-dialog .text {
  min-height: 32px;
  text-align: center;
}

.about-dialog .title {
  color: var(--floatFontColor);
}

.about-dialog .text {
  color: var(--floatFontColor);
}

.about-dialog .repo-link {
  display: block;
  text-align: center;
  color: var(--themeColor);
  text-decoration: none;
  min-height: 32px;
  line-height: 32px;
}

.about-dialog .repo-link:hover,
.about-dialog .repo-link:focus-visible {
  text-decoration: underline;
}
</style>
