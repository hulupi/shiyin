<script setup lang="ts">
import { currentPage as page } from "../services/router";
import { library } from "../stores/library";
import AppIcon from "./AppIcon.vue";
import { isAndroidOnline } from "../services/platform";
defineProps<{ mobileDrawer?: boolean }>();
const emit = defineEmits<{ navigate: [] }>();
const menus = [
  "首页",
  "搜索",
  "榜单",
  "发现歌单",
  "本地音乐",
  "我的收藏",
  "我的歌单",
  "下载管理",
  "播放历史",
  "设置",
].filter(name => !isAndroidOnline || !["首页", "本地音乐", "下载管理"].includes(name));
</script>
<template>
  <aside class="sidebar" :class="{ 'mobile-drawer': mobileDrawer }">
    <div class="brand">
      <AppIcon name="music" :size="30" /><b>拾音</b>
    </div>
    <nav>
      <el-button
        v-for="name in menus"
        :key="name"
        :class="{ active: page === name }"
        :title="name"
        :aria-current="page === name ? 'page' : undefined"
        @click="page = name; emit('navigate')"
        ><AppIcon class="nav-icon" :name="name" /><span class="nav-name">{{
          name
        }}</span
        ><i v-if="name === '本地音乐'">{{
          library.tracks.length
        }}</i></el-button
      >
    </nav>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 24px 9px 14px;
  background: var(--sidebar-surface);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  margin-bottom: 16px;
  font-size: 20px;
  color: var(--day-text, #f6faf7);
}

.brand > svg {
  color: var(--green);
}

nav {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sidebar .el-button {
  width: 100%;
  min-height: 36px;
  margin: 0;
  padding: 8px 12px;
  justify-content: flex-start;
  gap: 11px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--day-muted, #a2aaa5);
  font-size: 14px;
}

.sidebar .el-button > :deep(span) {
  display: contents;
}

.sidebar .el-button:hover {
  background: var(--day-surface-soft, #191d1b);
  color: var(--day-text, #f6faf7);
}

.sidebar .el-button.active {
  background: var(--day-selected, #202423);
  color: var(--day-text, #f6faf7);
}

.sidebar i {
  margin-left: auto;
  font-size: 12px;
  font-style: normal;
}

.sidebar.mobile-drawer {
  height: 100%;
}
</style>
