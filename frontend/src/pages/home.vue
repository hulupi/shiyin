<script setup lang="ts">
import ListSkeleton from "../components/ListSkeleton.vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Track } from "../../../backend/src/contracts";
import AppIcon from "../components/AppIcon.vue";
import CatalogCover from "../components/CatalogCover.vue";
import CatalogPlatformToolbar from "../components/CatalogPlatformToolbar.vue";
import CollectionView from "../components/CollectionView.vue";
import PageLayout from "../components/PageLayout.vue";
import { requestApi } from "../services/api";
import { currentPage, navigate } from "../services/router";
import { chartPlatforms, navigateToChart, type Chart } from "../stores/chartPreferences";
import { library, scanLibrary } from "../stores/library";
import { useHistoryOrder } from "../stores/useHistoryOrder";

defineProps<{ currentId?: string; playing: boolean; favoriteIds: string[] }>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();

const query = ref("");
const historyIds = useHistoryOrder(
  computed(() => library.value.history),
  computed(() => currentPage.value === "首页"),
);
const recentTracks = computed(() => {
  const trackIndex = new Map(
    [...library.value.tracks, ...(library.value.onlineTracks ?? [])].map((track) => [track.id, track]),
  );
  return historyIds.value
    .map((id) => trackIndex.get(id))
    .filter((track): track is Track => Boolean(track))
    .slice(0, 20);
});
const showLocal = computed(() => !recentTracks.value.length && library.value.tracks.length > 0);
const collection = computed(() => showLocal.value ? library.value.tracks : recentTracks.value);
const artists = computed(
  () => new Set(collection.value.map((track) => track.artist)).size,
);
const tracks = computed(() => {
  const keyword = showLocal.value ? query.value.trim().toLowerCase() : "";
  return keyword
    ? collection.value.filter((track) =>
        (track.title + " " + track.artist + " " + track.album)
          .toLowerCase()
          .includes(keyword),
      )
    : collection.value;
});

const platforms = chartPlatforms;
const platform = ref("wy");
const platformName = computed(() => platforms.find((item) => item.id === platform.value)?.name);
const charts = ref<Chart[]>([]);
const playlists = ref<Chart[]>([]);
function homeColumns() {
  if (window.matchMedia("(max-width: 700px)").matches) return 3;
  return window.matchMedia("(max-width: 1100px)").matches ? 4 : 8;
}
const columns = ref(homeColumns());
function updateColumns() {
  columns.value = homeColumns();
}
onMounted(() => window.addEventListener("resize", updateColumns));
onUnmounted(() => window.removeEventListener("resize", updateColumns));
const chartLimit = computed(() => columns.value === 3 ? 6 : 8);
const playlistLimit = computed(() => columns.value === 3 ? 12 : 16);
function completeRows(items: Chart[], limit: number) {
  const count = Math.min(items.length, limit);
  return items.slice(0, count - count % columns.value);
}
const visibleCharts = computed(() => completeRows(charts.value, chartLimit.value));
const loading = ref(false);
const chartError = ref(false);
const playlistError = ref(false);
const keyword = ref("");
const filteredPlaylists = computed(() => {
  const search = keyword.value.trim().toLowerCase();
  const matches = playlists.value.filter((item) => item.name.toLowerCase().includes(search));
  return search ? matches.slice(0, playlistLimit.value) : completeRows(matches, playlistLimit.value);
});
let active: AbortController | undefined;

async function loadHome(refresh = false) {
  active?.abort();
  const request = new AbortController();
  active = request;
  loading.value = true;
  chartError.value = false;
  playlistError.value = false;
  try {
    const data: { charts: Chart[] | null; playlists: Chart[] | null } = await requestApi(
      `/home/${platform.value}${refresh ? "?refresh=1" : ""}`,
      { signal: request.signal },
    );
    if (request.signal.aborted) return;
    chartError.value = data.charts === null;
    playlistError.value = data.playlists === null;
    if (data.charts) charts.value = data.charts;
    if (data.playlists) playlists.value = data.playlists;
  } catch {
    if (!request.signal.aborted) {
      chartError.value = true;
      playlistError.value = true;
    }
  } finally {
    if (!request.signal.aborted) loading.value = false;
  }
}

watch(platform, () => {
  charts.value = [];
  playlists.value = [];
  keyword.value = "";
  void loadHome();
}, { immediate: true });

onUnmounted(() => active?.abort());

function openPlaylist(playlist: Chart) {
  navigate("发现歌单", platform.value, playlist.id, {
    name: playlist.name,
    author: playlist.update,
    image: playlist.image,
  });
}
</script>

<template>
  <PageLayout class="home-page" title="发现音乐" :style="{ '--home-columns': columns }">
    <CatalogPlatformToolbar
      v-model="platform"
      :platforms="platforms"
      :loading="loading"
      label="首页音乐平台"
      @refresh="loadHome(true)"
    />

    <section class="home-section" :aria-busy="loading">
      <h2><AppIcon name="榜单" :size="20" />排行榜</h2>
      <p v-if="chartError" class="home-status" role="status">榜单加载失败，请刷新重试</p>
      <ListSkeleton v-else-if="loading && !visibleCharts.length" class="home-grid" layout="covers" :count="chartLimit" label="正在加载榜单" />
      <p v-else-if="!visibleCharts.length" class="home-status" role="status">
        暂无榜单
      </p>
      <div v-if="visibleCharts.length" class="home-grid">
        <button
          v-for="chart in visibleCharts"
          :key="chart.id"
          type="button"
          class="home-card"
          @click="navigateToChart(platform, chart)"
        >
          <CatalogCover :name="chart.name" :image="chart.image" />
          <strong :title="chart.name">{{ chart.name }}</strong>
          <small :title="chart.description || platformName">{{ chart.description || platformName }}</small>
        </button>
      </div>
    </section>

    <section class="home-section" :aria-busy="loading">
      <div class="home-section-heading">
        <h2><AppIcon name="发现歌单" :size="20" />推荐歌单</h2>
       
      </div>
      <p v-if="playlistError" class="home-status" role="status">推荐歌单加载失败，请刷新重试</p>
      <ListSkeleton v-else-if="loading && !filteredPlaylists.length" class="home-grid" layout="covers" :count="playlistLimit" label="正在加载推荐歌单" />
      <p v-else-if="!filteredPlaylists.length" class="home-status" role="status">
        {{ keyword.trim() ? "没有匹配的歌单" : "暂无推荐歌单" }}
      </p>
      <div v-if="filteredPlaylists.length" class="home-grid">
        <button v-for="playlist in filteredPlaylists" :key="playlist.id" type="button" class="home-card" @click="openPlaylist(playlist)">
          <CatalogCover :name="playlist.name" :image="playlist.image" compact-title />
          <strong :title="playlist.name">{{ playlist.name }}</strong>
          <small v-if="playlist.update" :title="playlist.update">{{ playlist.update }}</small>
        </button>
      </div>
    </section>

    <h2 v-if="collection.length" class="home-collection-heading">
      {{ showLocal ? "本地音乐" : "最近播放" }}
    </h2>
    <CollectionView
      v-if="collection.length"
      v-model:query="query"
      :tracks="tracks"
      :current-id="currentId"
      :playing="playing"
      :favorite-ids="favoriteIds"
      :scan-running="library.scan.running"
      :scanned="library.scan.scanned"
      @play="(track, list) => emit('play', track, list)"
      @favorite="emit('favorite', $event)"
      @enqueue="(track, next) => emit('enqueue', track, next)"
      @notify="emit('notify', $event)"
      @navigate="emit('navigate', $event)"
      :local="showLocal"
      :hide-toolbar="!showLocal"
      :track-count="library.tracks.length"
      :artists="artists"
      :directory-count="library.directories.length"
      @scan="scanLibrary()"
    />
  </PageLayout>
</template>

<style scoped lang="scss">
.home-page :deep(.content) {
  overflow-y: auto;
  padding-bottom: var(--list-bottom-padding);
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
}
.home-page :deep(.content > .collection-page) {
  flex: none;
}
.home-page :deep(.song-table-rows) {
  overflow: visible;
}
.home-section {
  min-width: 0;
  margin-bottom: 42px;
}
.home-section-heading,
.home-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.home-section-heading {
  justify-content: space-between;
  margin-bottom: 18px;
}
.home-section h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  margin: 0 0 18px;
}
.home-section-heading h2 {
  margin: 0;
}
.home-section h2 :deep(svg) {
  color: var(--green);
}
.home-grid {
  display: grid;
  grid-template-columns: repeat(var(--home-columns), minmax(0, 1fr));
  gap: 24px clamp(12px, 1.7vw, 28px);
}
.home-card {
  display: block;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 10px;
  color: inherit;
  background: none;
  text-align: left;
}
.home-card:hover :deep(img) {
  opacity: .85;
}
.home-card strong,
.home-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-card strong {
  margin-top: 9px;
  font-size: 13px;
  font-weight: 600;
}
.home-card small,
.home-status {
  color: var(--day-muted, #a2b3a8);
  font-size: 12px;
}
.home-card small {
  margin-top: 3px;
}
.home-collection-heading {
  margin: 0 0 12px;
  font-size: 16px;
}
@media (max-width: 700px) {
  .home-page :deep(.content) {
    overflow: visible;
  }
  .home-section {
    margin-bottom: 30px;
  }
}
</style>
