<script setup lang="ts">
import { currentPage as page } from "../services/router";
import { library } from "../stores/library";
import AppIcon from "./AppIcon.vue";
defineProps<{ mobileDrawer?: boolean }>();
const emit = defineEmits<{ navigate: [] }>();
const menus = [
  { name: "首页", icon: "⌂" },
  { name: "搜索", icon: "⌕" },
  { name: "榜单", icon: "▥" },
  { name: "发现歌单", icon: "◉" },
  { name: "本地音乐", icon: "♫" },
  { name: "我的收藏", icon: "♡" },
  { name: "我的歌单", icon: "☷" },
  { name: "下载管理", icon: "↓" },
  { name: "播放历史", icon: "◷" },
];
</script>
<template>
  <aside class="sidebar" :class="{ 'mobile-drawer': mobileDrawer }">
    <div class="brand">
      <AppIcon name="music" :size="30" /><b>拾音</b>
    </div>
    <nav>
      <el-button
        v-for="item in menus"
        :key="item.name"
        :class="{ active: page === item.name }"
        :title="item.name"
        @click="page = item.name; emit('navigate')"
        ><AppIcon class="nav-icon" :name="item.name" /><span class="nav-name">{{
          item.name
        }}</span
        ><i v-if="item.name === '本地音乐'">{{
          library.tracks.length
        }}</i></el-button
      >
    </nav>
    <div class="sidebar-bottom">
      <el-button
        :class="{ active: page === '设置' }"
        title="设置"
        @click="page = '设置'; emit('navigate')"
        ><AppIcon class="nav-icon" name="设置" /><span class="nav-name"
          >设置</span
        ></el-button
      >
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar {
  width: 224px;
  position: fixed;
  inset: 0 auto 108px 0;
  background: var(--day-surface, #0a0e0c);
  border-right: 1px solid var(--day-line, #1d251f);
  padding: 32px 16px;
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  font-size: 23px;
  letter-spacing: -1px;
}

.brand > span {
  color: var(--green);
  font-size: 36px;
  line-height: 1;
}

.brand b {
  color: var(--day-text, #f6faf7);
  font-weight: 700;
  white-space: nowrap;
}

.nav-label {
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--day-muted, #526157);
  margin: 42px 15px 15px;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.sidebar button {
  justify-content: flex-start;
  padding: 11px 14px;
  border-radius: 7px;
  color: var(--day-muted, #94a198);
  font-size: 14px;
  position: relative;
  gap: 12px;
}

.nav-icon {
  font-size: 24px;
  line-height: 1;
  width: 23px;
  text-align: center;
}

.sidebar button:hover {
  background: var(--day-surface-soft, #141d17);
  color: var(--day-text, #e8eeea);
}

.sidebar button.active {
  background: var(--day-selected, #173421);
  color: var(--day-accent-text, #62dd90);
}

.sidebar button.active:before {
  content: "";
  position: absolute;
  left: -16px;
  height: 20px;
  width: 3px;
  background: var(--green);
  border-radius: 0 2px 2px 0;
}

.sidebar i {
  font-size: 12px;
  font-style: normal;
  margin-left: auto;
  color: var(--day-muted, #7d9b86);
}

.sidebar-bottom {
  margin-top: auto;
  border-top: 1px solid var(--border);
  padding-top: 18px;
}

.sidebar-bottom button {
  width: 100%;
  margin-top: 10px;
}

@media (max-width: 1100px) {
  .sidebar {
    width: 190px;
  }

  .brand {
    font-size: 20px;
  }

  .sidebar button {
    padding: 12px;
  }

  .nav-label {
    margin-top: 30px;
  }
}

@media (max-width: 700px) {
  .sidebar {
    width: 62px;
    padding: 25px 6px;
    bottom: 94px;
  }

  .sidebar .brand {
    padding: 0;
    justify-content: center;
  }

  .sidebar .brand b,
  .nav-label,
  .sidebar i,
  .sidebar-bottom :deep(.nas-status),
  .nav-name {
    display: none;
  }

  .sidebar nav {
    margin-top: 35px;
    gap: 8px;
  }

  .sidebar button {
    gap: 0;
    justify-content: center;
    padding: 13px 8px;
  }

  .sidebar button.active:before {
    left: -6px;
  }

  .sidebar-bottom {
    padding-top: 7px;
  }

  .sidebar-bottom button {
    justify-content: center;
  }
}

.brand > svg {
  color: var(--green);
  flex-shrink: 0;
}

.nav-icon {
  flex-shrink: 0;
}

.sidebar {
  bottom: 132px;
}

@media (max-width: 700px) {
  .sidebar {
    bottom: 118px;
  }
}

@media (max-width: 700px) {
  .app-shell > .sidebar {
    bottom: var(--player-height);
  }
}

.app-shell > .sidebar {
  position: relative;
  inset: auto;
  width: auto;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.sidebar .brand,
.sidebar .nav-label,
.sidebar nav,
.sidebar-bottom {
  flex-shrink: 0;
}

.sidebar-bottom {
  padding-top: 18px;
  margin-top: auto;
}

@media (max-width: 700px) {
  .sidebar-bottom {
    padding-top: 7px;
  }
}
.sidebar .el-button {
  border: 0;
  background: none;
  margin: 0;
  height: auto;
}
.sidebar .el-button > :deep(span) {
  display: contents;
}
.sidebar .el-button {
  width: 100%;
}
.sidebar .el-button.active {
  background: var(--day-selected, #173421);
}
.sidebar .el-button:hover {
  background: var(--day-surface-soft, #141d17);
}
.app-shell > .sidebar {
  border: 1px solid var(--day-line, #ffffff15);
  border-radius: 22px;
  background: var(--day-surface, #0b110dcc);
  padding: 24px 14px 18px;
}
.sidebar .brand {
  font-size: 21px;
  padding: 0 10px;
  margin-block-end: 16px;
}
.sidebar .nav-label {
  margin-top: 30px;
}
.sidebar button.active:before {
  display: none;
}
@media (max-width: 700px) {
  .app-shell > .sidebar {
    padding: 22px 6px 12px;
    border-radius: 16px;
  }
}

.sidebar.mobile-drawer {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 24px 14px 18px;
  border: 0;
  border-radius: 0;
  background: var(--day-surface, #0a0e0c);
  overflow-y: auto;
}
.sidebar.mobile-drawer .brand { justify-content: flex-start; padding: 0 10px; }
.sidebar.mobile-drawer .brand b,
.sidebar.mobile-drawer .nav-name { display: inline; }
.sidebar.mobile-drawer .nav-label { display: block; }
.sidebar.mobile-drawer i { display: inline; }
.sidebar.mobile-drawer nav { margin-top: 0; gap: 5px; }
.sidebar.mobile-drawer button { justify-content: flex-start; gap: 12px; padding: 12px; }
</style>
