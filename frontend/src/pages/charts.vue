<script setup lang="ts">
import ListSkeleton from "../components/ListSkeleton.vue";
import RefreshButton from "../components/RefreshButton.vue";
import { nearScrollEnd, usePageScroll } from "../stores/usePageScroll";
import PageLayout from "../components/PageLayout.vue";
defineOptions({ name: "charts" });
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { route, navigate } from "../services/router";
import type { Track } from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import { isAndroidOnline } from "../services/platform";
import { loadPlaybackList } from "../services/playbackList";
import AppIcon from "../components/AppIcon.vue";
import ChartCard from "../components/ChartCard.vue";
import CatalogCover from "../components/CatalogCover.vue";
import CatalogPlatformToolbar from "../components/CatalogPlatformToolbar.vue";
import CatalogDetailToolbar from "../components/CatalogDetailToolbar.vue";
import SongTable from "../components/SongTable.vue";
import { chartPlatforms as platforms, chartPreference, fetchCharts, navigateToChart, type Chart } from "../stores/chartPreferences";
defineProps<{ currentId?: string; playing: boolean; favoriteIds: string[] }>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
const platform = ref("wy"),
  charts = ref<Chart[]>([]),
  selected = ref<Chart>(),
  tracks = ref<Track[]>([]),
  loading = ref(false),
  loadingMore = ref(false),
  error = ref(""),
  page = ref(1),
  total = ref(0),
  hasMore = ref(false);
const platformName = computed(
  () => platforms.find((item) => item.id === platform.value)?.name,
);
const uncategorizedGroups = new Set(["", "其他", "其它", "未分类", "其他榜", "其它榜", "其他榜单", "其它榜单"]);
const visibleCharts = computed(() =>
  charts.value.filter((chart) =>
    chartPreference(platform.value, chart.id, "visible") &&
    !uncategorizedGroups.has(chart.group.trim()),
  ),
);
let controller: AbortController | undefined;
let generation = 0;
async function loadCharts(refresh = false) {
  controller?.abort();
  const active = new AbortController();
  controller = active;
  generation++;
  loading.value = true;
  loadingMore.value = false;
  error.value = "";
  selected.value = undefined;
  charts.value = [];
  tracks.value = [];
  try {
    const directory = await fetchCharts(platform.value, { signal: active.signal, refresh });
    if (controller === active) {
      charts.value = directory;
    }
  } catch (e) {
    if (!active.signal.aborted)
      error.value = e instanceof Error ? e.message : "榜单加载失败";
  } finally {
    if (controller === active) loading.value = false;
  }
}
function selectPlatform(id: string | number | boolean) {
  if (typeof id !== "string" || platform.value === id) return;
  platform.value = id;
  goDirectory();
}
async function openChart(chart: Chart, refresh = false) {
  controller?.abort();
  const active = new AbortController();
  controller = active;
  generation++;
  selected.value = chart;
  tracks.value = [];
  page.value = 1;
  total.value = 0;
  hasMore.value = false;
  error.value = "";
  loading.value = true;
  loadingMore.value = false;
  if (!chart.image) {
    void fetchCharts(platform.value, { signal: active.signal })
      .then((directory) => {
        const entry = directory.find((item) => item.id === chart.id);
        if (controller === active && entry) selected.value = entry;
      })
      .catch(() => {});
  }
  try {
    const data = await api(
      `/charts/${platform.value}/${chart.id}?page=1${refresh ? "&refresh=1" : ""}`,
      { signal: active.signal },
    );
    if (controller !== active) return;
    tracks.value = data.tracks;
    total.value = data.total;
    hasMore.value = data.hasMore;
  } catch (e) {
    if (!active.signal.aborted)
      error.value = e instanceof Error ? e.message : "歌曲加载失败";
  } finally {
    if (controller === active) {
      loading.value = false;
      void nextTick(checkScroll);
    }
  }
}
async function loadMore() {
  if (
    !selected.value ||
    loading.value ||
    loadingMore.value ||
    !hasMore.value ||
    error.value
  )
    return;
  const activeGeneration = generation;
  const active = controller;
  loadingMore.value = true;
  try {
    const data = await api(
      `/charts/${platform.value}/${selected.value.id}?page=${page.value + 1}`,
      { signal: active?.signal },
    );
    if (activeGeneration !== generation) return;
    const ids = new Set(tracks.value.map((track) => track.id));
    tracks.value.push(
      ...data.tracks.filter((track: Track) => !ids.has(track.id)),
    );
    page.value++;
    hasMore.value = data.hasMore;
  } catch (e) {
    if (!active?.signal.aborted && activeGeneration === generation)
      error.value = e instanceof Error ? e.message : "加载更多失败";
  } finally {
    if (activeGeneration === generation) {
      loadingMore.value = false;
      void nextTick(checkScroll);
    }
  }
}
let playbackRequest = 0;
async function playList(track: Track, list: Track[]) {
  const chart = selected.value;
  if (!isAndroidOnline || !chart || !hasMore.value) {
    ++playbackRequest;
    emit("play", track, list);
    return;
  }
  const request = ++playbackRequest;
  const active = controller;
  try {
    const fullList = await loadPlaybackList(
      `/charts/${platform.value}/${chart.id}`,
      tracks.value, page.value, active?.signal,
    );
    if (request === playbackRequest && active === controller && !active?.signal.aborted) {
      emit("play", track, fullList);
    }
  } catch (error) {
    if (request === playbackRequest && active === controller && !active?.signal.aborted) {
      emit("notify", error instanceof Error ? error.message : "完整播放列表加载失败");
    }
  }
}
const container = ref<HTMLElement>();
usePageScroll(() => container.value, () => checkScroll());
function checkScroll(event?: Event) {
  const element =
    !window.matchMedia("(max-width: 700px)").matches && event?.target instanceof HTMLElement
      ? event.target
      : container.value?.querySelector<HTMLElement>(".song-table-rows");
  if (
    element?.classList.contains("song-table-rows") &&
    element.clientHeight > 0 &&
    nearScrollEnd(element)
  )
    void loadMore();
}
function retryDetail() {
  error.value = "";
  if (tracks.value.length) void loadMore();
  else if (selected.value) void openChart(selected.value);
}
function refresh() {
  if (selected.value) void openChart(selected.value, true);
  else void loadCharts(true);
}
function goDirectory() {
  navigate("榜单", platform.value);
}
function goChart(chart: Chart) {
  navigateToChart(platform.value, chart);
}
watch(
  route,
  () => {
    if (route.value.page !== "榜单") return;
    const r = route.value;
    platform.value = platforms.some((p) => p.id === r.platform)
      ? r.platform
      : "wy";
    if (r.id)
      void openChart({
        id: r.id,
        name: r.query.name || "榜单",
        update: r.query.update || "",
        image: "",
        description: "",
        count: 0,
        group: "",
      });
    else void loadCharts();
  },
  { immediate: true },
);
onUnmounted(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <PageLayout title="音乐榜单" directory>
    <template v-if="selected" #detail-toolbar>
      <CatalogDetailToolbar :loading="loading" back-label="返回榜单" @back="goDirectory" @refresh="refresh" />
    </template>
    <div ref="container" class="charts-page" @scroll.capture="checkScroll">
      <CatalogPlatformToolbar
        v-if="!selected"
        class="chart-platform-toolbar"
        :model-value="platform"
        :platforms="platforms"
        :loading="loading"
        label="榜单平台"
        @update:model-value="selectPlatform"
        @refresh="refresh"
      />
      <template v-if="selected">
        <div class="chart-detail-heading">
          <CatalogCover class="chart-detail-cover" :name="selected.name" :image="selected.image" />
          <div class="chart-detail-copy">
            <h2 :title="selected.name">{{ selected.name }}</h2>
            <p>
              {{ platformName }}<span v-if="total"> · {{ total }} 首歌曲</span
              ><span v-if="selected.update"> · 更新：{{ selected.update }}</span>
            </p>
            <el-button
              class="primary chart-play-all"
              type="primary"
              :disabled="!tracks.length"
              @click="playList(tracks[0], tracks)"
              ><AppIcon name="play" :size="14" />播放全部</el-button
            >
          </div>
        </div>
        <el-alert v-if="error" type="error" :closable="false" :title="error"
          ><el-button text @click="retryDetail">重试</el-button></el-alert
        >
        <SongTable
          batch
          :key="selected.id"
          :paginate="false"
          :tracks="tracks"
          :loading="loading"
          :loading-more="loadingMore"
          :current-id="currentId"
          :playing="playing"
          :favorite-ids="favoriteIds"
          @play="playList"
          @favorite="emit('favorite', $event)"
          @enqueue="(track, next) => emit('enqueue', track, next)"
          @notify="emit('notify', $event)"
          @navigate="emit('navigate', $event)"
        >
          <template #empty>
            <div class="charts-state">
              <AppIcon name="榜单" :size="32" />
              <p>{{ error ? "暂时无法获取歌曲" : "这个榜单暂时没有歌曲" }}</p>
            </div>
          </template>
        </SongTable>
      </template>
      <div v-else-if="loading" class="chart-directory">
        <ListSkeleton class="chart-grid" layout="cards" label="正在加载排行榜" />
      </div>
      <div v-else-if="error || !visibleCharts.length" class="charts-state">
        <AppIcon name="榜单" :size="34" />
        <p>{{ error || "没有显示的榜单，可在设置中调整" }}</p>
        <RefreshButton v-if="error" label="重新加载" @click="loadCharts(true)" />
      </div>
      <div v-else class="chart-directory">
        <div class="chart-grid">
          <ChartCard
            v-for="chart in visibleCharts"
            :key="platform + ':' + chart.id"
            :chart="chart"
            :platform-name="platformName"
            @open="goChart(chart)"
          />
        </div>
      </div>
    </div>
  </PageLayout>
</template>

<style scoped lang="scss">
.primary,
.secondary {
  padding: 11px 18px;
  border-radius: 7px;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
}

.primary {
  background: var(--green);
  color: var(--day-on-accent, #072512);
}

.primary:hover {
  background: var(--day-accent-hover, #68e294);
}

.secondary {
  border: 1px solid var(--day-line, #344239);
  background: var(--day-surface-soft, #18201b);
  color: var(--day-text, #b8c8be);
}

.charts-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}
.chart-directory {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
  padding: 0 6px 20px 0;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
  gap: 12px;
}
.chart-detail-heading {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 18px;
  margin-bottom: 8px;
}
.chart-detail-cover {
  flex: 0 0 108px;
}
.chart-detail-copy {
  min-width: 0;
  flex: 1;
}
.chart-detail-copy p {
  font-size: 13px;
  margin-top: 4px;
}
.chart-detail-copy h2 {
  font-size: 24px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.chart-play-all {
  height: 30px;
  margin-top: 12px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
}
.chart-play-all :deep(span) {
  gap: 5px;
}
.charts-state {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
  color: var(--day-muted, #7aa78a);
  text-align: center;
}
.charts-state p {
  font-size: 14px;
}
.charts-page > .chart-platform-toolbar,
.chart-detail-heading,
.charts-page > :deep(.el-alert),
.charts-page :deep(.song-toolbar),
.charts-page :deep(.table-header) {
  margin-right: 32px;
}
.charts-page :deep(.song-table-rows) {
  padding-right: 32px;
  padding-bottom: var(--list-bottom-padding);
}
.chart-directory {
  padding-right: 32px;
  padding-bottom: var(--list-bottom-padding);
}
@media (max-width: 700px) {
  .chart-grid {
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 9px;
  }
  .chart-detail-heading {
    gap: 12px;
  }
  .chart-detail-cover {
    flex-basis: 84px;
  }
  .chart-detail-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
    min-height: 84px;
  }
  .chart-detail-copy h2 {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
    font-size: 15px;
    line-height: 17px;
  }
  .chart-detail-copy p {
    max-width: 100%;
    overflow: hidden;
    margin: 3px 0 0;
    font-size: 12px;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chart-detail-copy .chart-play-all.el-button {
    box-sizing: border-box;
    height: 30px;
    min-height: 30px;
    margin-top: auto;
    padding: 0 8px;
    font-size: 12px;
  }
  .charts-page > .chart-platform-toolbar,
  .chart-detail-heading,
  .charts-page > :deep(.el-alert),
  .charts-page :deep(.song-toolbar),
  .charts-page :deep(.table-header) {
    margin-right: 14px;
  }
  .charts-page :deep(.song-table-rows),
  .chart-directory {
    padding-right: 14px;
  }
}

@media (max-width: 700px) {
  .charts-page :deep(.song-batch-toolbar > .el-button) {
    flex: 0 0 calc((100% - 8px) / 2);
    margin: 0;
  }
  .charts-page :deep(.song-batch-toolbar > span) {
    order: 1;
    margin-inline-start: auto;
    font-size: 12px;
    white-space: nowrap;
    color: var(--muted);
  }

}
</style>
