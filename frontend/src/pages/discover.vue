<script setup lang="ts">
import ListSkeleton from "../components/ListSkeleton.vue";
import CatalogCover from "../components/CatalogCover.vue";
import RefreshButton from "../components/RefreshButton.vue";
import { nearScrollEnd, usePageScroll } from "../stores/usePageScroll";
import PageLayout from "../components/PageLayout.vue";
defineOptions({ name: "discover" });
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { route, navigate } from "../services/router";
import type { Track } from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import AppIcon from "../components/AppIcon.vue";
import SongTable from "../components/SongTable.vue";
interface Chart {
  id: string;
  name: string;
  image: string;
  description: string;
  update: string;
  count: number;
  group: string;
}
defineProps<{ currentId?: string; playing: boolean; favoriteIds: string[] }>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
const platforms = [
  { id: "wy", name: "网易云音乐" },
  { id: "tx", name: "QQ 音乐" },
  { id: "kw", name: "酷我音乐" },
  { id: "kg", name: "酷狗音乐" },
  { id: "mg", name: "咪咕音乐" },
];
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
const groups = computed(() => [
  ...new Set(charts.value.map((chart) => chart.group)),
]);
const directoryPage = ref(1),
  directoryHasMore = ref(false),
  directoryFailed = ref(false);
const keyword = ref(""),
  submittedSearch = ref(""),
  searchTotal = ref(0);
function search() {
  submittedSearch.value = keyword.value.trim();
  goDirectory();
}
function clearSearch() {
  keyword.value = "";
  if (submittedSearch.value) {
    submittedSearch.value = "";
    goDirectory();
  }
}
interface FilterOption {
  id: string;
  name: string;
}
interface CategoryGroup {
  name: string;
  items: FilterOption[];
}
const sort = ref(""),
  category = ref("all"),
  filterGroups = ref<CategoryGroup[]>([]),
  sorts = ref<FilterOption[]>([]),
  categorySorts = ref<FilterOption[]>([]);
let filterPlatform = "";
const availableSorts = computed(() =>
  category.value === "all" ? sorts.value : categorySorts.value,
);
function directoryUrl(pageNumber = 1, refresh = false) {
  const query = new URLSearchParams({ page: String(pageNumber) });
  if (submittedSearch.value) query.set("q", submittedSearch.value);
  else {
    query.set("sort", sort.value);
    query.set("category", category.value);
  }
  if (refresh) query.set("refresh", "1");
  return `/discover/${platform.value}${submittedSearch.value ? "/search" : ""}?${query}`;
}
function changeSort(id: string | number | boolean) {
  if (typeof id !== "string" || (sort.value === id && !submittedSearch.value)) return;
  keyword.value = "";
  submittedSearch.value = "";
  sort.value = id;
  goDirectory();
}
function changeCategory() {
  keyword.value = "";
  submittedSearch.value = "";
  if (!availableSorts.value.some((item) => item.id === sort.value))
    sort.value = availableSorts.value[0]?.id || "";
  goDirectory();
}
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
  directoryFailed.value = false;
  selected.value = undefined;
  tracks.value = [];
  directoryPage.value = 1;
  directoryHasMore.value = false;
  try {
    if (filterPlatform !== platform.value || refresh) {
      const metadata = await api(
        `/discover/${platform.value}/filters${refresh ? "?refresh=1" : ""}`,
        { signal: active.signal },
      );
      if (controller !== active) return;
      filterGroups.value = metadata.groups;
      sorts.value = metadata.sorts;
      categorySorts.value = metadata.categorySorts;
      filterPlatform = platform.value;
      if (
        category.value !== "all" &&
        !filterGroups.value.some((group) =>
          group.items.some((item) => item.id === category.value),
        )
      )
        category.value = "all";
    }
    if (!availableSorts.value.some((item) => item.id === sort.value))
      sort.value = availableSorts.value[0]?.id || "";
    const data = await api(directoryUrl(1, refresh), { signal: active.signal });
    if (controller === active) {
      charts.value = data.charts;
      searchTotal.value = Number(data.total) || 0;
      directoryHasMore.value = Boolean(data.hasMore);
      await nextTick();
      const directory =
        container.value?.querySelector<HTMLElement>(".chart-directory");
      if (directory) directory.scrollTop = 0;
    }
  } catch (e) {
    if (!active.signal.aborted) {
      directoryFailed.value = true;
      error.value = e instanceof Error ? e.message : "歌单加载失败";
    }
  } finally {
    if (controller === active) {
      loading.value = false;
      void nextTick(checkScroll);
    }
  }
}
function selectPlatform(id: string | number | boolean) {
  if (typeof id !== "string" || platform.value === id) return;
  platform.value = id;
  category.value = "all";
  sort.value = "";
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
  try {
    const data = await api(
      `/discover/${platform.value}/${chart.id}?page=1${refresh ? "&refresh=1" : ""}`,
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
async function loadDirectoryMore() {
  if (
    selected.value ||
    loading.value ||
    loadingMore.value ||
    !directoryHasMore.value ||
    error.value
  )
    return;
  const activeGeneration = generation;
  const active = controller;
  loadingMore.value = true;
  try {
    const data = await api(directoryUrl(directoryPage.value + 1), {
      signal: active?.signal,
    });
    if (activeGeneration !== generation) return;
    const ids = new Set(charts.value.map((item) => item.id));
    const additions = data.charts.filter((item: Chart) => !ids.has(item.id));
    charts.value.push(...additions);
    directoryPage.value++;
    directoryHasMore.value = Boolean(data.hasMore) && additions.length > 0;
  } catch (e) {
    if (!active?.signal.aborted && activeGeneration === generation)
      error.value = e instanceof Error ? e.message : "加载更多歌单失败";
  } finally {
    if (activeGeneration === generation) {
      loadingMore.value = false;
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
      `/discover/${platform.value}/${selected.value.id}?page=${page.value + 1}`,
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
const container = ref<HTMLElement>();
usePageScroll(() => container.value, () => checkScroll());
function checkScroll(event?: Event) {
  const element =
    !window.matchMedia("(max-width: 700px)").matches && event?.target instanceof HTMLElement
      ? event.target
      : container.value?.querySelector<HTMLElement>(
          selected.value ? ".song-table-rows" : ".chart-directory",
        );
  if (
    !element ||
    element.clientHeight <= 0 ||
    !nearScrollEnd(element)
  )
    return;
  if (element.classList.contains("song-table-rows")) void loadMore();
  else if (element.classList.contains("chart-directory"))
    void loadDirectoryMore();
}
function retryDirectory() {
  if (directoryFailed.value) {
    void loadCharts();
    return;
  }
  error.value = "";
  void loadDirectoryMore();
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
function routeQuery() {
  return {
    ...(submittedSearch.value ? { q: submittedSearch.value } : {}),
    ...(sort.value ? { sort: sort.value } : {}),
    ...(category.value !== "all" ? { category: category.value } : {}),
  };
}
function goDirectory() {
  navigate("发现歌单", platform.value, "", routeQuery());
}
function goChart(chart: Chart) {
  navigate("发现歌单", platform.value, chart.id, {
    ...routeQuery(),
    name: chart.name,
    author: chart.update,
  });
}
watch(
  route,
  () => {
    if (route.value.page !== "发现歌单") return;
    const r = route.value;
    platform.value = platforms.some((p) => p.id === r.platform)
      ? r.platform
      : "wy";
    category.value = r.query.category || "all";
    sort.value = r.query.sort || "";
    submittedSearch.value = r.query.q || "";
    keyword.value = submittedSearch.value;
    if (r.id)
      void openChart({
        id: r.id,
        name: r.query.name || "歌单",
        update: r.query.author || "",
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
  <PageLayout title="发现歌单" description="浏览各平台的精选公开歌单" directory>
    <div
      ref="container"
      class="charts-page discovery-page"
      @scroll.capture="checkScroll"
    >
      <div class="platform-tabs music-segmented-scroll">
        <el-segmented
          class="music-segmented"
          :model-value="platform"
          :options="platforms"
          :props="{ value: 'id', label: 'name' }"
          aria-label="音乐平台"
          @change="selectPlatform"
        />
      </div>
      <div v-if="!selected" class="playlist-filters">
        <div v-if="availableSorts.length" class="playlist-sort music-segmented-scroll">
          <el-segmented
            class="music-segmented"
            :model-value="submittedSearch ? '' : sort"
            :options="availableSorts"
            :props="{ value: 'id', label: 'name' }"
            aria-label="歌单排序"
            @change="changeSort"
          />
        </div>
        <el-select
          v-if="!submittedSearch && sorts.length"
          v-model="category"
          filterable
          clearable
          :empty-values="['all']"
          value-on-clear="all"
          aria-label="歌单分类"
          placeholder="全部分类"
          class="playlist-category"
          popper-class="playlist-category-menu"
          :fit-input-width="false"
          @change="changeCategory"
          ><el-option-group
            v-for="group in filterGroups"
            :key="group.name"
            :label="group.name"
            ><el-option
              v-for="item in group.items"
              :key="item.id"
              :value="item.id"
              :label="item.name" /></el-option-group
        ></el-select>
        <el-form class="playlist-search-form" @submit.prevent="search"
          ><el-input
            v-model="keyword"
            :placeholder="`搜索${platformName}公开歌单`"
            aria-label="搜索公开歌单"
            maxlength="100"
            clearable
            @clear="clearSearch"
            ><template #prefix
              ><AppIcon name="搜索" :size="16" /></template></el-input
          ><el-button
            class="primary"
            type="primary"
            native-type="submit"
            :disabled="loading || !keyword.trim()"
            >搜索</el-button
          ></el-form
        >
        <RefreshButton :disabled="loading" @click="refresh" />
      </div>
      <div v-if="!selected" class="playlist-search-summary" aria-live="polite">
        <template v-if="submittedSearch"
          >{{ platformName }} · “{{ submittedSearch }}”<span v-if="!loading && !error">
            · {{ searchTotal }} 个歌单</span
          ></template
        ><template v-else>{{
          category === "all"
            ? "精选歌单"
            : filterGroups
                .flatMap((group) => group.items)
                .find((item) => item.id === category)?.name || "精选歌单"
        }}</template>
      </div>
      <template v-if="selected">
        <div class="chart-detail-heading">
          <div class="chart-detail-copy">
            <h2>{{ selected.name }}</h2>
            <p>
              {{ platformName }}<span v-if="total"> · {{ total }} 首歌曲</span
              ><span v-if="selected.update"> · {{ selected.update }}</span>
            </p>
          </div>
        </div>
        <el-alert v-if="error" type="error" :closable="false" :title="error"
          ><el-button text @click="retryDetail">重试</el-button></el-alert
        >
        <SongTable
          batch
          searchable
          :key="selected.id"
          :paginate="false"
          :tracks="tracks"
          :loading="loading"
          :loading-more="loadingMore"
          :current-id="currentId"
          :playing="playing"
          :favorite-ids="favoriteIds"
          @play="(track, list) => emit('play', track, list)"
          @favorite="emit('favorite', $event)"
          @enqueue="(track, next) => emit('enqueue', track, next)"
          @notify="emit('notify', $event)"
          @navigate="emit('navigate', $event)"
        >
          <template #actions>
            <el-button class="secondary" @click="goDirectory"
              >← {{ submittedSearch ? "搜索结果" : "全部歌单" }}</el-button
            ><RefreshButton :loading="loading" @click="refresh" />
            <el-button
              class="primary"
              type="primary"
              :disabled="!tracks.length"
              @click="emit('play', tracks[0], tracks)"
              ><AppIcon name="play" :size="15" />播放全部</el-button
            >
          </template>
          <template #empty>
            <div class="charts-state">
              <AppIcon name="发现歌单" :size="32" />
              <p>{{ error ? "暂时无法获取歌曲" : "这个歌单暂时没有歌曲" }}</p>
            </div>
          </template>
        </SongTable>
      </template>
      <div v-else-if="!charts.length && !loading" class="charts-state">
        <AppIcon name="发现歌单" :size="34" />
        <p>
          {{
            error ||
                (submittedSearch
                  ? "没有找到匹配的歌单，换个关键词试试"
                  : "暂无可用歌单")
          }}
        </p>
        <RefreshButton v-if="error" label="重新加载" @click="loadCharts(true)" />
      </div>
      <div
        v-else
        class="chart-directory"
        :class="{ 'directory-updating': loading }"
        :aria-busy="loading"
      >
        <ListSkeleton v-if="loading" class="chart-grid" layout="covers" :count="12" label="正在加载歌单" />
        <template v-else>
          <section v-for="group in groups" :key="group" class="chart-group">
            <div class="chart-grid">
              <button
                v-for="chart in charts.filter(
                  (item) => item.group === group,
                )"
                :key="platform + ':' + chart.id"
                class="chart-card"
                :disabled="loading || directoryFailed"
                @click="goChart(chart)"
              >
                <div class="chart-art">
                  <CatalogCover :name="chart.name" :image="chart.image" compact-title />
                  <span class="chart-play"><AppIcon name="play" :size="20" /></span>
                </div>
                <div class="chart-card-copy">
                  <strong :title="chart.name">{{ chart.name }}</strong
                  ><small class="playlist-card-meta"
                    ><span
                      class="playlist-card-author"
                      :title="chart.update || '未知作者'"
                      >{{ chart.update || "未知作者" }}</span
                    ><span class="playlist-card-count"
                      >{{ chart.count }} 首歌曲</span
                    ></small
                  >
                </div>
              </button>
            </div>
          </section>
        </template>
        <div v-if="error" class="discovery-load-status">
          <span>{{ error }}</span
          ><el-button class="secondary" @click="retryDirectory">重试</el-button>
        </div>
        <ListSkeleton v-else-if="loadingMore" class="chart-grid" layout="covers" label="正在加载更多歌单" />
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

.text-button {
  color: var(--green);
  font-size: 13px;
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
.charts-page > .platform-tabs {
  flex-shrink: 0;
  margin-bottom: 24px;
}
.chart-directory {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
  padding: 0 6px 20px 0;
}
.chart-group + .chart-group {
  margin-top: 26px;
}
.chart-group > h2 {
  font-size: 15px;
  margin-bottom: 13px;
  color: var(--day-text, #c5d5ca);
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
  gap: 12px;
}
.chart-card {
  min-width: 0;
  text-align: left;
  justify-content: flex-start;
  gap: 14px;
  border: 1px solid var(--day-line, #ffffff0e);
  background: var(--day-surface-soft, #16251b88);
  border-radius: 12px;
  padding: 12px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.chart-card:hover,
.chart-card:focus-visible {
  background: var(--day-selected, #213d2bcc);
  border-color: #66c78666;
}
.chart-art {
  position: relative;
  width: 76px;
  height: 76px;
  flex: 0 0 76px;
  border-radius: 9px;
  overflow: hidden;
}
.chart-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #0006;
  opacity: 0;
  transition: opacity 0.15s;
}
.chart-card:hover .chart-play,
.chart-card:focus-visible .chart-play {
  opacity: 1;
}
.chart-card-copy {
  min-width: 0;
}
.chart-card-copy strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chart-card-copy small {
  display: block;
  font-size: 12px;
  color: var(--day-muted, #7f9a89);
  margin-top: 7px;
}
.chart-card-copy p {
  font-size: 13px;
  margin-top: 5px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.chart-detail-heading {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 16px;
  margin-bottom: 18px;
}
.chart-detail-copy {
  min-width: 0;
  flex: 1;
}
.chart-detail-copy p {
  font-size: 13px;
  margin-top: 4px;
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
.charts-page > .platform-tabs,
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
  .charts-page > .platform-tabs {
    gap: 6px;
    margin-bottom: 18px;
  }
  .chart-grid {
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 9px;
  }
  .chart-card {
    padding: 10px;
    gap: 12px;
  }
  .chart-art {
    width: 64px;
    height: 64px;
    flex-basis: 64px;
  }
  .chart-detail-heading {
    flex-wrap: wrap;
    gap: 10px;
  }
  .chart-detail-copy {
    flex-basis: calc(100% - 120px);
  }
  .charts-page > .platform-tabs,
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

.discovery-page .chart-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
  gap: 24px 20px;
}
.discovery-page .chart-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.discovery-page .chart-card:hover,
.discovery-page .chart-card:focus-visible {
  background: transparent;
}
.discovery-page .chart-card:focus-visible {
  outline: 2px solid #66c786;
  outline-offset: 4px;
}
.discovery-page .chart-art {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  flex: none;
  border-radius: 4px;
}
.discovery-page .chart-card-copy strong {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
  font-weight: 500;
}
.discovery-page .chart-card-copy .playlist-card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  font-size: 14px;
  line-height: 1.5;
}
.playlist-card-author {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.playlist-card-count {
  flex-shrink: 0;
  white-space: nowrap;
}
@media (max-width: 700px) {
  .discovery-page .chart-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
    gap: 20px 14px;
  }
  .discovery-page .chart-card {
    gap: 10px;
  }
}
.discovery-load-status {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 22px 0;
  font-size: 14px;
  color: var(--day-muted, #8eaa98);
}

.playlist-filters {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin: -8px 32px 18px 0;
  flex-shrink: 0;
}
.playlist-category.el-select {
  width: 200px;
}
@media (max-width: 700px) {
  .discovery-page > .platform-tabs {
    margin-bottom: 10px;
  }
  .playlist-filters {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 1fr) 32px;
    gap: 8px;
    margin: 0 14px 12px 0;
  }
  .playlist-category.el-select {
    grid-column: 2 / -1;
    width: 100%;
    min-width: 0;
  }
  .playlist-category.el-select :deep(.el-select__wrapper) {
    min-height: 32px;
    padding-block: 0;
  }
  .playlist-filters > :deep(.refresh-button) {
    grid-column: 3;
    justify-self: end;
  }
}
.playlist-category :deep(.el-select__wrapper) {
  min-height: 38px;
  border-radius: 9px;
  background: var(--day-surface-soft, #15231a);
}
.playlist-category :deep(.el-select__input),
.playlist-category :deep(.el-select__input:focus),
.playlist-category :deep(.el-select__input:focus-visible) {
  border: 0;
  border-radius: 0;
  outline: none;
  box-shadow: none;
  background: transparent;
  padding: 0;
  color: inherit;
}
:global(.playlist-category-menu.el-popper) {
  width: 280px;
  max-width: calc(100vw - 32px);
  border: 1px solid var(--day-line, #344c3b);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 36px #0006;
}
:global(.playlist-category-menu .el-select-dropdown__wrap) {
  max-height: 340px;
}
:global(.playlist-category-menu .el-select-dropdown__list) {
  padding: 6px;
}
:global(.playlist-category-menu .el-select-dropdown__item) {
  padding-inline: 12px;
  height: 36px;
  line-height: 36px;
  margin: 2px 0;
  border-radius: 6px;
  font-size: 14px;
}
:global(.playlist-category-menu .el-select-group__title) {
  padding: 8px 12px 4px;
  height: auto;
  line-height: 24px;
  color: var(--day-muted, #728e7b);
  font-size: 13px;
}
:global(.playlist-category-menu .el-select-group__wrap:not(:last-of-type)) {
  padding-bottom: 12px;
  margin-bottom: 4px;
}
:global(
  .playlist-category-menu .el-select-group__wrap:not(:last-of-type)::after
) {
  left: 12px;
  right: 12px;
  bottom: 3px;
  background: var(--day-selected, #2b3e31);
}
:global(.playlist-category-menu .el-select-dropdown__item.is-selected) {
  background: var(--day-selected, #244330);
  color: var(--day-accent-text, #78e69e);
  font-weight: 500;
}
:global(.playlist-category-menu .el-select-dropdown__item.is-hovering) {
  background: var(--day-selected, #263c2e);
}

.playlist-search-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
}
.playlist-search-form :deep(.el-input) {
  width: 270px;
}
.playlist-search-form :deep(.el-input__wrapper) {
  background: var(--day-surface-soft, #15231a);
  border-radius: 9px;
}
.playlist-search-summary {
  margin: -5px 32px 16px 0;
  flex-shrink: 0;
  font-size: 14px;
  color: var(--day-muted, #93b09e);
  overflow-wrap: anywhere;
}
@media (max-width: 1100px) {
  .playlist-search-form :deep(.el-input) {
    width: 210px;
  }
}
@media (max-width: 700px) {
  .playlist-search-form {
    grid-column: 1 / 3;
    margin-left: 0;
  }
  .playlist-search-form :deep(.el-input) {
    flex: 1;
    width: 0;
  }
  .playlist-search-form :deep(.el-input__wrapper),
  .playlist-search-form :deep(.el-input__inner),
  .playlist-search-form > :deep(.el-button) {
    min-height: 0;
    height: 32px;
  }
  .playlist-search-form > :deep(.el-button) {
    padding-block: 0;
  }
  .playlist-search-summary {
    margin-right: 14px;
  }
}
.playlist-search-summary {
  min-height: 24px;
  line-height: 24px;
  margin-top: -6px;
  margin-bottom: 10px;
}
.playlist-search-form > :deep(.el-button) {
  box-sizing: border-box;
  flex: 0 0 72px;
  width: 72px;
  padding-inline: 4px;
}
.discovery-page .directory-updating {
  pointer-events: none;
}
.discovery-page .chart-card:disabled {
  opacity: 1;
  cursor: progress;
}

@media (max-width: 700px) {
  .chart-detail-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
  }
  .chart-detail-heading .chart-detail-copy {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
  }
  .chart-detail-copy h2 { font-size: 19px; line-height: 1.4; overflow-wrap: anywhere; }
  .chart-detail-copy p { font-size: 12px; line-height: 1.6; }
}
</style>
