<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
} from "vue";
import type { Component } from "vue";
import type { Track } from "../../backend/src/contracts";
import { currentPage, routeNames } from "./services/router";
import {
  library,
  preferredQuality,
  refreshLibrary,
  toggleFavorite,
} from "./stores/library";
import { requestApi } from "./services/api";
import { notify, reportError } from "./services/feedback";
import AppSidebar from "./components/AppSidebar.vue";
import AppIcon from "./components/AppIcon.vue";
import AppTheme from "./components/AppTheme.vue";
import MusicPlayer from "./components/MusicPlayer.vue";
import { pausePlaybackKey } from "./stores/playbackControl";
const page = currentPage;
const mobileMenuOpen = ref(false);
const mobileViewport = window.matchMedia("(max-width: 700px)");
const isMobile = ref(mobileViewport.matches);
function updateViewport() {
  isMobile.value = mobileViewport.matches;
  mobileMenuOpen.value = false;
}
onMounted(() => mobileViewport.addEventListener("change", updateViewport));
onUnmounted(() => mobileViewport.removeEventListener("change", updateViewport));
const pages = Object.fromEntries(
  Object.entries(import.meta.glob<{ default: Component }>("./pages/*.vue")).map(
    ([path, loader]) => [
      path.split("/").pop()!.replace(".vue", ""),
      defineAsyncComponent(loader),
    ],
  ),
);
const renderedPage = ref(page.value),
  switchingPage = ref(false);
const routeComponent = computed(() => pages[routeNames[renderedPage.value]]);
const current = ref<Track | null>(null),
  playing = ref(false);
const player = ref<InstanceType<typeof MusicPlayer>>();
provide(pausePlaybackKey, () => player.value?.pause());
let pageFrame = 0,
  pageTask: ReturnType<typeof setTimeout> | undefined;
watch(
  page,
  (value) => {
    mobileMenuOpen.value = false;
    cancelAnimationFrame(pageFrame);
    clearTimeout(pageTask);
    switchingPage.value = true;
    pageFrame = requestAnimationFrame(() => {
      pageTask = setTimeout(() => {
        if (page.value !== value) return;
        renderedPage.value = value;
        switchingPage.value = false;
      }, 0);
    });
  },
  { flush: "sync" },
);
function play(track: Track, list: Track[]) {
  player.value?.play(track, list);
}
function enqueue(track: Track, next = false) {
  player.value?.enqueue(track, next);
}
let timer: ReturnType<typeof setInterval>;
onMounted(async () => {
  await Promise.all([
    refreshLibrary(),
    requestApi("/sources/settings")
      .then((settings) => {
        preferredQuality.value = settings.quality;
      })
      .catch(reportError),
  ]);
  timer = setInterval(() => {
    if (library.value.scan.running) void refreshLibrary();
  }, 1200);
});
onUnmounted(() => {
  cancelAnimationFrame(pageFrame);
  clearTimeout(pageTask);
  clearInterval(timer);
});
</script>
<template>
  <AppTheme />
  <div class="app-shell">
    <AppSidebar v-if="!isMobile" />
    <header v-if="isMobile" class="mobile-header">
      <button class="menu-toggle" aria-label="打开菜单" :aria-expanded="mobileMenuOpen" aria-controls="mobile-navigation" @click="mobileMenuOpen = true">
        <AppIcon name="menu" :size="22" />
      </button>
      <AppIcon name="music" :size="24" /><b>拾音</b>
    </header>
    <el-drawer v-if="isMobile" v-model="mobileMenuOpen" direction="ltr" size="min(270px, 80vw)" :with-header="false" class="mobile-navigation-drawer" aria-label="导航菜单">
      <AppSidebar id="mobile-navigation" mobile-drawer @navigate="mobileMenuOpen = false" />
    </el-drawer>
    <main
      :aria-busy="switchingPage"
      :class="{ 'page-switching': switchingPage }"
    >
      <KeepAlive
        :include="['search', 'charts', 'discover', 'playlists', 'downloads']"
      >
        <component
          :is="routeComponent"
          :key="renderedPage"
          :current-id="current?.id"
          :playing="playing"
          :favorite-ids="library.favorites"
          @play="play"
          @favorite="toggleFavorite"
          @enqueue="enqueue"
          @notify="notify"
          @navigate="page = $event"
        />
      </KeepAlive>
      <div v-if="switchingPage" class="page-loading" role="status" :aria-label="'正在打开' + page">
        <AppIcon name="refresh" :size="20" spinning />
      </div>
    </main>
    <MusicPlayer
      ref="player"
      @current="current = $event"
      @playing="playing = $event"
    />
  </div>
</template>

<style scoped lang="scss">
main {
  margin-left: 224px;
  padding-bottom: 125px;
  min-height: 100vh;
}

@media (max-width: 1100px) {
  main {
    margin-left: 190px;
  }
}

@media (max-width: 700px) {
  main {
    margin-left: 62px;
    padding-bottom: 110px;
  }
}

main {
  padding-bottom: 149px;
}

@media (max-width: 700px) {
  main {
    padding-bottom: 134px;
  }
}

.app-shell {
  height: 100dvh;
  overflow: hidden;
}

.app-shell > main {
  height: calc(100dvh - var(--player-height));
  min-height: 0;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  padding-bottom: var(--player-height);
  overflow: hidden;
}

.app-shell > main {
  margin: 0;
  padding: 0;
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-loading {
  position: absolute;
  inset: 20px;
  display: grid;
  place-items: center;
  color: var(--day-muted, #8eaa98);
  font-size: 14px;
}
.app-shell {
  padding: 8px;
  gap: 0;
  background: radial-gradient(
    ellipse at 35% 0%,
    var(--day-selected, #264333) 0%,
    var(--day-surface-soft, #151e19) 40%,
    var(--el-bg-color-page, #101311) 75%
  );
}
.app-shell > main {
  padding-bottom: var(--player-height);
}
@media (max-width: 700px) {
  .app-shell {
    padding: 5px;
  }
}
.app-shell > :deep(main:has(.local-content, .floating-content)) {
  padding-bottom: 0;
}
.app-shell:has(.local-content, .floating-content) {
  padding-right: 0;
}
.app-shell:has(.charts-page) {
  padding-right: 0;
}
.app-shell > :deep(main:has(.charts-page)) {
  padding-bottom: 0;
}
.app-shell > main {
  position: relative;
}
.page-switching > :not(.page-loading) {
  visibility: hidden;
}

.mobile-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--day-line, #ffffff12);
  background: var(--day-surface, #101713);
}
.mobile-header > .app-icon { color: var(--green); }
.menu-toggle {
  display: grid;
  place-items: center;
  width: 36px;
  height: 40px;
  margin-left: -8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--day-text, #dcebe1);
  cursor: pointer;
}
.menu-toggle:focus-visible { outline: 2px solid var(--green); }
:global(.mobile-navigation-drawer .el-drawer__body) { padding: 0; }
@media (max-width: 700px) {
  .app-shell,
  .app-shell:has(.local-content, .floating-content),
  .app-shell:has(.charts-page) {
    padding: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 53px minmax(0, 1fr);
  }
  .app-shell > :deep(main:has(.route-page)) {
    padding-bottom: 0;
  }
}
@media (min-width: 701px) {
  .app-shell > :deep(main:has(.settings-layout)) {
    padding-bottom: calc(var(--desktop-player-bar-height) + var(--desktop-player-bottom));
  }
}
</style>
