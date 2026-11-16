<script setup lang="ts">
import ListSkeleton from "../components/ListSkeleton.vue";
import PageLayout from "../components/PageLayout.vue";
defineOptions({ name: "search" });
import { ElMessage } from "element-plus";
import { onActivated, onDeactivated, onUnmounted, ref, watch } from "vue";
import type { AlbumSearchResult, Track } from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import AppIcon from "../components/AppIcon.vue";
import { appUrl } from "../services/urls";
import BatchTrackActions from "../components/BatchTrackActions.vue";
import SongTable from "../components/SongTable.vue";
import { nearScrollEnd, usePageScroll } from "../stores/usePageScroll";
const props = defineProps<{
  currentId?: string;
  playing: boolean;
  favoriteIds: string[];
}>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
import { isAndroidOnline } from "../services/platform";
const platforms = [
  { id: "all", name: "全部" },
  ...(isAndroidOnline ? [] : [{ id: "local", name: "本地" }]),
  { id: "wy", name: "网易云" },
  { id: "tx", name: "QQ" },
  { id: "kw", name: "酷我" },
  { id: "kg", name: "酷狗" },
  { id: "mg", name: "咪咕" },
];
const noSources = ref(false);
let sourceController: AbortController | undefined;
onActivated(async () => {
  const active = new AbortController();
  sourceController = active;
  noSources.value = false;
  try {
    const sources = await api("/sources", { signal: active.signal });
    if (!active.signal.aborted) noSources.value = sources.length === 0;
  } catch {
    // Show the import prompt only when the source list is confirmed empty.
  }
});
onDeactivated(() => sourceController?.abort());

const mode = ref<"songs" | "albums">("songs");
const searchModes = [
  { value: "songs", label: "歌曲" },
  { value: "albums", label: "专辑" },
];
const albums = ref<AlbumSearchResult[]>([]);
const selectedAlbum = ref<AlbumSearchResult>();
let albumController: AbortController | undefined;
const keyword = ref(""),
  platform = ref("all"),
  results = ref<Track[]>([]),
  loading = ref(false),
  loadingMore = ref(false),
  loadError = ref(""),
  hasMore = ref(false),
  error = ref(""),
  page = ref(1),
  searched = ref(false),
  pageSize = 50,
  submittedKeyword = ref("");
const statuses = ref<
  { platform: string; total: number; error: string | null }[]
>([]);
watch(
  error,
  (text) => {
    if (text) {
      ElMessage.error({ message: text, grouping: true });
      error.value = "";
    }
  },
  { flush: "sync" },
);
let controller: AbortController | undefined;
async function search() {
  submittedKeyword.value = keyword.value.trim();
  controller?.abort();
  controller = undefined;
  closeAlbum();
  loading.value = false;
  searched.value = false;
  albums.value = [];
  results.value = [];
  statuses.value = [];
  if (!submittedKeyword.value) return;
  const active = new AbortController();
  controller = active;
  loading.value = true;
  loadingMore.value = false;
  loadError.value = "";
  hasMore.value = false;
  error.value = "";
  results.value = [];
  page.value = 1;
  statuses.value = [];
  const query = encodeURIComponent(submittedKeyword.value);
  if (mode.value === "albums") {
    try {
      await fetchAlbums(1, active);
      if (controller === active) searched.value = true;
    } catch (e) {
      if (!active.signal.aborted) error.value = e instanceof Error ? e.message : "专辑搜索失败";
    } finally {
      if (controller === active) loading.value = false;
    }
    return;
  }
  try {
    const data = await api(
      `/catalog/search?q=${query}&platform=${platform.value}&page=1&pageSize=${pageSize}${isAndroidOnline ? "&onlineOnly=1" : ""}`,
      { signal: active.signal },
    );
    if (controller !== active) return;
    results.value = data.tracks;
    statuses.value = data.platforms;
    hasMore.value = data.tracks.length > 0 && pageSize < data.total;
    searched.value = true;
  } catch (e) {
    if (!active.signal.aborted)
      error.value = e instanceof Error ? e.message : "搜索失败";
  } finally {
    if (controller === active) loading.value = false;
  }
}
async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value || !controller)
    return;
  const active = controller;
  const nextPage = page.value + 1;
  const query = encodeURIComponent(submittedKeyword.value);
  loadingMore.value = true;
  loadError.value = "";
  try {
    if (mode.value === "albums") {
      await fetchAlbums(nextPage, active);
      return;
    }
    const data = await api(
      `/catalog/search?q=${query}&platform=${platform.value}&page=${nextPage}&pageSize=${pageSize}${isAndroidOnline ? "&onlineOnly=1" : ""}`,
      { signal: active.signal },
    );
    if (controller !== active) return;
    const ids = new Set(results.value.map((track) => track.id));
    const additions = (data.tracks as Track[]).filter(
      (track) => !ids.has(track.id),
    );
    results.value.push(...additions);
    page.value = nextPage;
    statuses.value = data.platforms;
    hasMore.value = additions.length > 0 && nextPage * pageSize < data.total;
  } catch (e) {
    if (!active.signal.aborted && controller === active)
      loadError.value = e instanceof Error ? e.message : "加载更多失败";
  } finally {
    if (controller === active) loadingMore.value = false;
  }
}
async function fetchAlbums(nextPage: number, active: AbortController) {
  const data = await api(`/catalog/albums?q=${encodeURIComponent(submittedKeyword.value)}&platform=${platform.value}&page=${nextPage}`, { signal: active.signal });
  if (controller !== active) return;
  const ids = new Set(albums.value.map(album => album.platform + ":" + album.id));
  albums.value.push(...(data.albums as AlbumSearchResult[]).filter(album => !ids.has(album.platform + ":" + album.id)));
  page.value = nextPage;
  hasMore.value = data.hasMore;
  const failures = new Map(statuses.value.map(status => [status.platform, status]));
  for (const status of data.platforms || []) failures.set(status.platform, status);
  statuses.value = [...failures.values()];
}
const searchContainer = ref<HTMLElement>();
const albumResults = ref<HTMLElement>();
function checkAlbumScroll() {
  const list = albumResults.value;
  if (list && list.clientHeight > 0 && !loadError.value && nearScrollEnd(list))
    void loadMore();
}
usePageScroll(() => searchContainer.value, checkAlbumScroll);
watch([albumResults, page, loading, loadingMore], checkAlbumScroll, { flush: "post" });

const albumLoading = ref(false);
function closeAlbum() {
  albumController?.abort();
  selectedAlbum.value = undefined;
  albumLoading.value = false;
  if (mode.value === "albums") results.value = [];
}
async function openAlbum(album: AlbumSearchResult) {
  closeAlbum();
  const active = new AbortController();
  albumController = active;
  selectedAlbum.value = album;
  albumLoading.value = true;
  try {
    const data = await api(`/catalog/albums/${album.platform}/tracks?id=${encodeURIComponent(album.id)}&name=${encodeURIComponent(album.name)}&artist=${encodeURIComponent(album.artist)}`, { signal: active.signal });
    if (!active.signal.aborted) results.value = data.tracks;
  } catch (e) {
    if (!active.signal.aborted) {
      closeAlbum();
      error.value = e instanceof Error ? e.message : "无法读取专辑歌曲";
    }
  } finally {
    if (!active.signal.aborted) albumLoading.value = false;
  }
}
function selectMode(value: string | number | boolean) {
  if (value !== "songs" && value !== "albums") return;
  if (mode.value === value) return;
  mode.value = value;
  void search();
}
function selectPlatform(id: string | number | boolean) {
  if (typeof id !== "string" || id === platform.value) return;
  platform.value = id;
  void search();
}
const name = (id: string) =>
  platforms.find((item) => item.id === id)?.name || id;
onUnmounted(() => {
  controller?.abort();
  albumController?.abort();
});
</script>
<template>
  <PageLayout
    floating
    title="搜索音乐"
    description="发现喜欢的歌曲，本地文件优先播放，多音源自动兜底。"
  >
    <div ref="searchContainer" class="online-search">
      <el-form class="online-search-form" @submit.prevent="search()"
        ><label class="search-input"
          ><AppIcon name="搜索" /><el-input
            v-model="keyword"
            maxlength="100"
            clearable
            :placeholder="mode === 'albums' ? '搜索专辑名或歌手' : '搜索歌曲或歌手'"
          /></label
        ><el-button
          class="primary"
          type="primary"
          native-type="submit"
          :loading="loading"
          >{{ loading ? "搜索中…" : "搜索" }}</el-button
        ></el-form
      >
      <div class="platform-tabs music-segmented-scroll">
        <el-segmented
          class="music-segmented"
          :model-value="mode"
          :options="searchModes"
          aria-label="搜索类型"
          @change="selectMode"
        />
      </div>
      <div class="platform-tabs music-segmented-scroll">
        <el-segmented
          class="music-segmented"
          :model-value="platform"
          :options="platforms"
          :props="{ value: 'id', label: 'name' }"
          aria-label="搜索平台"
          @change="selectPlatform"
        />
      </div>
      <div
        v-if="statuses.some((item) => item.error)"
        class="search-platform-errors"
      >
        <span
          v-for="status in statuses.filter((item) => item.error)"
          :key="status.platform"
          >{{ name(status.platform) }}搜索暂不可用</span
        ><el-button class="text-button" @click="search()" text>重试</el-button>
      </div>
      <div v-if="mode === 'albums' && selectedAlbum" class="album-heading">
        <el-button @click="closeAlbum()">返回专辑列表</el-button>
        <strong>{{ selectedAlbum.name }} · {{ selectedAlbum.artist }}</strong>
        <el-button v-if="results.length" @click="emit('play', results[0], results)">播放全部</el-button>
        <BatchTrackActions v-if="results.length" :tracks="results" whole-album />
      </div>
      <div
        v-if="mode === 'albums' && !selectedAlbum && (loading || albums.length)"
        ref="albumResults"
        class="album-results"
        @scroll.passive="checkAlbumScroll"
      >
        <ListSkeleton v-if="loading && !albums.length" class="album-grid" layout="covers" label="正在搜索专辑" />
        <div v-else class="album-grid">
          <button v-for="album in albums" :key="album.platform + ':' + album.id" class="album-result" @click="openAlbum(album)">
            <span class="album-art">
              <img v-if="album.image" :src="album.image" alt="" loading="lazy" />
              <img v-else-if="album.coverTrackId" :src="appUrl('/api/tracks/' + encodeURIComponent(album.coverTrackId) + '/cover')" alt="" loading="lazy" />
              <AppIcon v-else name="music" :size="32" />
            </span>
            <strong :title="album.name">{{ album.name }}</strong>
            <span class="album-meta">
              <span class="album-artist" :title="album.artist">{{ album.artist }}</span>
              <span v-if="platform === 'all'">{{ name(album.platform) }}</span>
            </span>
          </button>
        </div>
        <div v-if="loadError" class="album-load-status" role="alert">
          <span>{{ loadError }}</span>
          <el-button text @click="loadMore()">重试</el-button>
        </div>
        <ListSkeleton v-else-if="loadingMore" class="album-grid" layout="covers" label="正在加载更多专辑" />
      </div>
      <SongTable
        :paginate="false"
        :infinite="mode === 'songs'"
        :has-more="mode === 'songs' && hasMore"
        :loading-more="mode === 'songs' && loadingMore"
        :load-error="loadError"
        @load-more="loadMore"
        v-if="results.length || (mode === 'songs' && loading) || (selectedAlbum && albumLoading)"
        :loading="selectedAlbum ? albumLoading : loading"
        :tracks="results"
        :current-id="props.currentId"
        :playing="props.playing"
        :favorite-ids="props.favoriteIds"
        @play="(track, list) => emit('play', track, list)"
        @favorite="emit('favorite', $event)"
        @enqueue="(track, next) => emit('enqueue', track, next)"
        @notify="emit('notify', $event)"
        @navigate="emit('navigate', $event)"
      />
      <div v-else-if="selectedAlbum || (!loading && !albums.length)" class="empty-state">
        <div class="empty-icon"><AppIcon name="搜索" :size="38" /></div>
        <h2>
          {{
            selectedAlbum
              ? "这张专辑暂无歌曲"
              : searched
                ? "暂无匹配结果"
                : "想听什么，搜一下"
          }}
        </h2>
        <p v-if="!selectedAlbum && searched">可切换平台或更换关键词再试。</p>
        <p v-else-if="!selectedAlbum && !loading && noSources">
          <el-link href="#/settings?section=sources" type="primary">
            先在设置中导入音源，即可解析并播放在线歌曲。
          </el-link>
        </p>
      </div>
    </div>
  </PageLayout>
</template>

<style scoped lang="scss">
.album-heading { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.online-search > .album-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
  padding: 4px var(--list-right-inset) var(--list-bottom-padding) 4px;
}
.album-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, max(120px, calc((100% - 140px) / 8))), 1fr));
  gap: 24px 20px;
}
.album-result {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: 0;
  text-align: left;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.album-result:focus-visible {
  outline: 2px solid #66c786;
  outline-offset: 4px;
}
.album-art {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  margin-bottom: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--day-surface-soft, #20362a);
}
.album-art > img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: cover;
}
.album-result > strong,
.album-artist {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.album-result > strong {
  font-weight: 500;
  line-height: 1.5;
}
.album-meta,
.album-load-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--day-muted, #8fa497);
}
.album-artist { flex: 1; }
.album-meta > :last-child { white-space: nowrap; }
.album-load-status {
  justify-content: center;
  padding: 16px 0;
}
@media (max-width: 700px) {
  .online-search > .album-results {
    overflow: visible;
    overscroll-behavior: auto;
    scrollbar-gutter: auto;
  }
  .album-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
    gap: 20px 14px;
  }
}
.primary {
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

.search-input {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--day-surface-soft, #161e18);
  border: 1px solid var(--day-line, #2a352d);
  border-radius: 7px;
  padding: 0 13px;
  color: var(--day-muted, #718378);
  width: 280px;
}

.search-input > span {
  font-size: 25px;
}

.search-input input {
  background: none;
  border: 0;
  padding: 10px 0;
  width: 100%;
  font-size: 13px;
}

.search-input input:focus {
  outline: none;
}

.search-input:focus-within {
  border-color: var(--green);
}

.empty-state {
  min-height: 330px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  border: 1px dashed var(--day-line, #2a3a2e);
  border-radius: 12px;
  background: radial-gradient(ellipse at center, var(--day-surface-soft, #19281e70), transparent 70%);
}

.empty-icon {
  width: 80px;
  height: 80px;
  display: grid;
  place-items: center;
  border-radius: 23px;
  background: var(--day-selected, #203426);
  color: var(--day-muted, #73ab84);
  margin-bottom: 22px;
  border: 1px solid var(--day-line, #304b38);
  font-size: 45px;
}

.empty-state h2 {
  font-size: 19px;
}

.empty-state p {
  font-size: 14px;
  margin: 12px 0 23px;
}

.text-button {
  color: var(--green);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .search-input {
    width: 240px;
  }
}

@media (max-width: 700px) {
  .search-input {
    width: 100%;
  }

  .empty-state {
    min-height: 340px;
    padding: 25px 12px;
  }

  .empty-state p {
    font-size: 13px;
  }

  .empty-state h2 {
    font-size: 17px;
  }
}

.online-search-form {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.online-search-form .search-input {
  flex: 1;
  width: auto;
}

.online-search-form input {
  padding-block: 13px;
  font-size: 14px;
}

.platform-tabs {
  margin-bottom: 12px;
}

.search-platform-errors {
  display: flex;
  gap: 13px;
  align-items: center;
  flex-wrap: wrap;
  color: var(--day-muted, #a99a69);
  font-size: 12px;
  padding-bottom: 18px;
}

.online-search {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.online-search > :not(.song-table) {
  flex-shrink: 0;
}
.search-input :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
.search-input :deep(.el-input__wrapper) {
  box-shadow: none;
  background: transparent;
  padding: 0;
}
.search-input :deep(.el-input__inner) {
  width: 100%;
  font-size: 14px;
  padding: 0;
}
.online-search-form,
.platform-tabs,
.search-platform-errors {
  margin-right: var(--list-right-inset);
}
</style>
