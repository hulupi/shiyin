<script setup lang="ts">
import { App as NativeApp } from "@capacitor/app";
import { onAndroidFavoritesChanged } from "./android/favorites";
import {
  computed,
  defineAsyncComponent,
  h,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
} from "vue";
import type { Component } from "vue";
import type { Track } from "../../backend/src/contracts";
import { backFromAndroidDetail, currentPage, routeNames } from "./services/router";
import {
  library,
  preferredQuality,
  refreshLibrary,
  toggleFavorite,
} from "./stores/library";
import { requestApi } from "./services/api";
import { notify, reportError } from "./services/feedback";
import { isAndroidOnline } from "./services/platform";
import AppSidebar from "./components/AppSidebar.vue";
import AppIcon from "./components/AppIcon.vue";
import AppTheme from "./components/AppTheme.vue";
import MusicPlayer from "./components/MusicPlayer.vue";
import { pausePlaybackKey } from "./stores/playbackControl";
const page = currentPage;
const mobileMenuOpen = ref(false);
if (isAndroidOnline) {
  let subscription: ReturnType<typeof NativeApp.addListener> | undefined;
  let favoritesSubscription: ReturnType<typeof onAndroidFavoritesChanged> | undefined;
  const refreshFavoritesOnResume = () => { if (!document.hidden) void refreshLibrary(); };
  onMounted(() => {
    subscription = NativeApp.addListener("backButton", () => {
      if (!backFromAndroidDetail()) void NativeApp.minimizeApp().catch(reportError);
    });
    void subscription.catch(reportError);
    favoritesSubscription = onAndroidFavoritesChanged(() => { void refreshLibrary(); });
    void favoritesSubscription.catch(reportError);
    document.addEventListener("visibilitychange", refreshFavoritesOnResume);
  });
  onUnmounted(() => {
    void subscription?.then(handle => handle.remove()).catch(() => {});
    void favoritesSubscription?.then(handle => handle.remove()).catch(() => {});
    document.removeEventListener("visibilitychange", refreshFavoritesOnResume);
  });
}
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
      defineAsyncComponent({
        loader,
        delay: 0,
        timeout: 15000,
        loadingComponent: {
          render: () => h("p", { class: "page-load-status", role: "status" }, "正在打开页面…"),
        },
        errorComponent: {
          render: () => h("p", { class: "page-load-status", role: "alert" }, [
            "页面加载失败。请重新加载应用后再试。",
            h("button", { type: "button", onClick: () => window.location.reload() }, "重新加载"),
          ]),
        },
      }),
    ],
  ),
);
const routeComponent = computed(() => pages[routeNames[page.value]]);
const current = ref<Track | null>(null),
  playing = ref(false);
const player = ref<InstanceType<typeof MusicPlayer>>();
provide(pausePlaybackKey, () => player.value?.pause());
watch(page, () => { mobileMenuOpen.value = false; });
function play(track: Track, list: Track[]) {
  if (!isAndroidOnline || track.online) player.value?.play(track, isAndroidOnline ? list.filter(item => item.online) : list);
}
function enqueue(track: Track, next = false) {
  if (!isAndroidOnline || track.online) player.value?.enqueue(track, next);
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
    <main>
      <KeepAlive
        :include="['search', 'charts', 'discover', 'playlists', 'downloads']"
      >
        <component
          :is="routeComponent"
          :key="page"
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
    </main>
    <MusicPlayer
      ref="player"
      @current="current = $event"
      @playing="playing = $event"
    />
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
  background: var(--el-bg-color-page);
}

.app-shell > main {
  position: relative;
  margin: 0;
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:global(.page-load-status) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--day-muted, #8eaa98);
}
.mobile-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--day-line, #ffffff12);
  background: var(--day-surface, #101713);
}
:global(html.android .mobile-header) {
  background: var(--android-header-background);
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
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 53px minmax(0, 1fr);
  }
  .app-shell > :deep(main:has(.route-page)) {
    padding-bottom: 0;
  }
}
@media (min-width: 701px) {
  .app-shell > main {
    --player-scroll-clearance: calc(var(--desktop-player-bar-height) + var(--desktop-player-bottom));
  }

  .app-shell > main:not(:has(.song-table, .chart-directory, .playlist-directory, .online-search, .downloads-page, .playlists-page)) {
    padding-bottom: var(--player-scroll-clearance);
  }
}
</style>
