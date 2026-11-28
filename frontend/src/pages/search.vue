<script setup lang="ts">
import ListSkeleton from "../components/ListSkeleton.vue";
import PageLayout from "../components/PageLayout.vue";
defineOptions({ name: "search" });
import { ElMessage } from "element-plus";
import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from "vue";
import type { AlbumSearchResult, Track } from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import { route } from "../services/router";
import CatalogCover from "../components/CatalogCover.vue";
import CatalogDetailToolbar from "../components/CatalogDetailToolbar.vue";
import type { Chart } from "../stores/chartPreferences";
import AppIcon from "../components/AppIcon.vue";
import { appUrl } from "../services/urls";
import BatchTrackActions from "../components/BatchTrackActions.vue";
import SongTable from "../components/SongTable.vue";
import ImportPlaylistButton from "../components/ImportPlaylistButton.vue";
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

const mode = ref<"songs" | "albums" | "playlists">("songs");
const searchModes = [
  { value: "songs", label: "歌曲" },
  { value: "albums", label: "专辑" },
  { value: "playlists", label: "歌单" },
];
const playlists = ref<Chart[]>([]);
const albums = ref<AlbumSearchResult[]>([]);
const selectedAlbum = ref<AlbumSearchResult>();
const selectedPlaylist = ref<Chart>();
let albumController: AbortController | undefined;
const keyword = ref(""),
  platform = ref("wy"),
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
const hotKeywords = ref<string[]>([]);
const showHotSearch = computed(() =>
  mode.value === "songs" && !keyword.value.trim() && !submittedKeyword.value,
);
async function loadHotSearch() {
  if (!showHotSearch.value) return;
  try {
    const data = await api("/catalog/hot-search");
    hotKeywords.value = data.keywords;
  } catch {
    // Keep the default search prompt when QQ Music is unavailable.
  }
}
onActivated(loadHotSearch);
watch(showHotSearch, (visible) => { if (visible) void loadHotSearch(); });

function searchHotKeyword(text: string) {
  keyword.value = text;
  platform.value = "tx";
  void search();
}

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
  closeDetail();
  loading.value = false;
  searched.value = false;
  albums.value = [];
  playlists.value = [];
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
  if (mode.value !== "songs") {
    try {
      if (mode.value === "playlists") await fetchPlaylists(1, active);
      else await fetchAlbums(1, active);
      if (controller === active) searched.value = true;
    } catch (e) {
      if (!active.signal.aborted) error.value = e instanceof Error ? e.message : "搜索失败";
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
    if (mode.value === "playlists") {
      await fetchPlaylists(nextPage, active);
      return;
    }
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
async function fetchPlaylists(nextPage: number, active: AbortController) {
  const query = new URLSearchParams({ q: submittedKeyword.value, page: String(nextPage) });
  const data = await api(`/discover/${platform.value}/search?${query}`, { signal: active.signal });
  if (controller !== active) return;
  const ids = new Set(playlists.value.map((playlist) => playlist.id));
  playlists.value.push(...(data.charts as Chart[]).filter((playlist) => !ids.has(playlist.id)));
  page.value = nextPage;
  hasMore.value = data.hasMore;
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

const detailLoading = ref(false);
const detailLoadingMore = ref(false);
const detailError = ref("");
const detailPage = ref(1);
const detailHasMore = ref(false);
const detailTotal = ref(0);
const detail = computed(() => selectedAlbum.value || selectedPlaylist.value);
const detailImage = computed(() => {
  const album = selectedAlbum.value;
  return detail.value?.image || (album?.coverTrackId
    ? appUrl("/api/tracks/" + encodeURIComponent(album.coverTrackId) + "/cover")
    : "");
});
function closeDetail() {
  albumController?.abort();
  selectedAlbum.value = undefined;
  selectedPlaylist.value = undefined;
  detailLoading.value = false;
  detailLoadingMore.value = false;
  detailError.value = "";
  detailHasMore.value = false;
  detailTotal.value = 0;
  results.value = [];
}
async function openAlbum(album: AlbumSearchResult) {
  closeDetail();
  const active = new AbortController();
  albumController = active;
  selectedAlbum.value = album;
  detailLoading.value = true;
  try {
    const data = await api(`/catalog/albums/${album.platform}/tracks?id=${encodeURIComponent(album.id)}&name=${encodeURIComponent(album.name)}&artist=${encodeURIComponent(album.artist)}`, { signal: active.signal });
    if (!active.signal.aborted) results.value = data.tracks;
  } catch (e) {
    if (!active.signal.aborted) {
      detailError.value = e instanceof Error ? e.message : "无法读取专辑歌曲";
    }
  } finally {
    if (!active.signal.aborted) detailLoading.value = false;
  }
}
function openPlaylist(playlist: Chart, refresh = false) {
  closeDetail();
  selectedPlaylist.value = playlist;
  albumController = new AbortController();
  detailPage.value = 1;
  detailTotal.value = playlist.count;
  return fetchPlaylistTracks(1, refresh);
}
async function fetchPlaylistTracks(nextPage: number, refresh = false) {
  const playlist = selectedPlaylist.value;
  const active = albumController;
  if (!playlist || !active || detailLoading.value || detailLoadingMore.value) return;
  const loadingState = nextPage === 1 ? detailLoading : detailLoadingMore;
  loadingState.value = true;
  detailError.value = "";
  try {
    const data = await api(`/discover/${platform.value}/${playlist.id}?page=${nextPage}${refresh ? "&refresh=1" : ""}`, { signal: active.signal });
    if (active.signal.aborted) return;
    const ids = new Set(results.value.map((track) => track.id));
    results.value.push(...(data.tracks as Track[]).filter((track) => !ids.has(track.id)));
    detailPage.value = nextPage;
    detailTotal.value = data.total;
    detailHasMore.value = data.hasMore;
  } catch (e) {
    if (!active.signal.aborted)
      detailError.value = e instanceof Error ? e.message : "无法读取歌单歌曲";
  } finally {
    if (!active.signal.aborted) loadingState.value = false;
  }
}
function refreshDetail() {
  if (selectedAlbum.value) void openAlbum(selectedAlbum.value);
  else if (selectedPlaylist.value) void openPlaylist(selectedPlaylist.value, true);
}
function searchFromDetail(text: string) {
  keyword.value = text;
  void search();
}
function selectMode(value: string | number | boolean) {
  if (value !== "songs" && value !== "albums" && value !== "playlists") return;
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
watch(
  route,
  ({ page, query }) => {
    const q = query.q?.trim();
    if (page !== "搜索" || !q) return;
    keyword.value = q;
    mode.value = query.mode === "playlists" ? "playlists" : "songs";
    platform.value = platforms.find(({ id }) => id === query.platform)?.id || "wy";
    void search();
  },
  { immediate: true },
);
onUnmounted(() => {
  controller?.abort();
  albumController?.abort();
});
</script>
<template>
  <PageLayout
    floating
    title="搜索音乐"
  >
    <template v-if="detail" #detail-toolbar>
      <CatalogDetailToolbar
        :loading="detailLoading"
        back-label="返回搜索结果"
        inline-search
        @back="closeDetail"
        @refresh="refreshDetail"
        @search="searchFromDetail"
      />
    </template>
    <div ref="searchContainer" class="online-search">
      <template v-if="detail">
        <div class="search-detail-heading">
          <CatalogCover class="search-detail-cover" :name="detail.name" :image="detailImage" compact-title />
          <div class="search-detail-copy">
            <h2 :title="detail.name">{{ detail.name }}</h2>
            <p>{{ name(selectedAlbum?.platform || platform) }} · {{ selectedPlaylist ? detailTotal : results.length }} 首歌曲<span v-if="selectedAlbum?.artist || selectedPlaylist?.update"> · {{ selectedAlbum?.artist || selectedPlaylist?.update }}</span></p>
            <div class="search-detail-actions">
              <el-button type="primary" class="primary detail-play-all" :disabled="!results.length" @click="emit('play', results[0], results)">
                <AppIcon name="play" :size="14" />播放全部
              </el-button>
              <ImportPlaylistButton
                v-if="results.length"
                :name="detail.name"
                :tracks="selectedAlbum ? results : undefined"
                :source="selectedPlaylist ? { platform, id: selectedPlaylist.id } : undefined"
              />
              <BatchTrackActions v-if="selectedAlbum && results.length" :tracks="results" whole-album />
            </div>
          </div>
        </div>
        <SongTable
          batch
          :tracks="results"
          :loading="detailLoading"
          :loading-more="detailLoadingMore"
          :load-error="detailError"
          :has-more="detailHasMore"
          :paginate="false"
          infinite
          :current-id="props.currentId"
          :playing="props.playing"
          :favorite-ids="props.favoriteIds"
          @load-more="fetchPlaylistTracks(detailPage + 1)"
          @play="(track, list) => emit('play', track, list)"
          @favorite="emit('favorite', $event)"
          @enqueue="(track, next) => emit('enqueue', track, next)"
          @notify="emit('notify', $event)"
          @navigate="emit('navigate', $event)"
        >
          <template #empty>
            <div class="empty-state">
              <h2>{{ detailError || "暂无歌曲" }}</h2>
              <el-button v-if="detailError" text @click="refreshDetail">重试</el-button>
            </div>
          </template>
        </SongTable>
      </template>
      <template v-else>
      <el-form class="online-search-form" @submit.prevent="search()"
        ><label class="search-input"
          ><AppIcon name="搜索" /><el-input
            v-model="keyword"
            maxlength="100"
            clearable
            @clear="search()"
            :placeholder="mode === 'playlists' ? '搜索公开歌单' : mode === 'albums' ? '搜索专辑名或歌手' : '搜索歌曲或歌手'"
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
      <div
        v-if="mode === 'albums' && (loading || albums.length)"
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
            </span>
          </button>
        </div>
        <div v-if="loadError" class="album-load-status" role="alert">
          <span>{{ loadError }}</span>
          <el-button text @click="loadMore()">重试</el-button>
        </div>
        <ListSkeleton v-else-if="loadingMore" class="album-grid" layout="covers" label="正在加载更多专辑" />
      </div>
      <div
        v-else-if="mode === 'playlists' && (loading || playlists.length)"
        ref="albumResults"
        class="album-results"
        @scroll.passive="checkAlbumScroll"
      >
        <ListSkeleton v-if="loading" class="album-grid" layout="covers" label="正在搜索歌单" />
        <div v-else class="album-grid">
          <button v-for="playlist in playlists" :key="playlist.id" type="button" class="album-result" @click="openPlaylist(playlist)">
            <CatalogCover class="album-art" :name="playlist.name" :image="playlist.image" compact-title />
            <strong :title="playlist.name">{{ playlist.name }}</strong>
            <span class="album-meta">
              <span class="album-artist">{{ playlist.update }}</span>
              <span v-if="playlist.count">{{ playlist.count }} 首</span>
            </span>
          </button>
        </div>
        <div v-if="loadError" class="album-load-status" role="alert">
          <span>{{ loadError }}</span>
          <el-button text @click="loadMore()">重试</el-button>
        </div>
        <ListSkeleton v-else-if="loadingMore" class="album-grid" layout="covers" label="正在加载更多歌单" />
      </div>
      <SongTable
        :paginate="false"
        :infinite="mode === 'songs'"
        :has-more="mode === 'songs' && hasMore"
        :loading-more="mode === 'songs' && loadingMore"
        :load-error="loadError"
        @load-more="loadMore"
        v-else-if="mode === 'songs' && (results.length || loading)"
        :loading="loading"
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
      <section v-else-if="showHotSearch && hotKeywords.length" class="hot-search" aria-label="热门搜索">
        <h2>热门搜索 <span>QQ 音乐</span></h2>
        <div class="hot-search-keywords">
          <button v-for="text in (isAndroidOnline ? hotKeywords.slice(0, 30) : hotKeywords)" :key="text" type="button" @click="searchHotKeyword(text)">
            {{ text }}
          </button>
        </div>
      </section>
      <div v-else class="empty-state">
        <div class="empty-icon"><AppIcon name="搜索" :size="38" /></div>
        <h2>{{ searched ? "暂无匹配结果" : "想听什么，搜一下" }}</h2>
        <p v-if="searched">可切换平台或更换关键词再试。</p>
        <p v-else-if="mode !== 'playlists' && noSources">
          <el-link href="#/settings?section=sources" type="primary">
            先在设置中导入音源，即可解析并播放在线歌曲。
          </el-link>
        </p>
      </div>
      </template>
    </div>
  </PageLayout>
</template>

<style scoped lang="scss">
.hot-search {
  overflow-y: auto;
  margin-right: var(--list-right-inset);
  padding: clamp(14px, 3vw, 24px);
  border: 1px solid var(--day-line, #2a3a2e);
  border-radius: 12px;
}
.hot-search h2 {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 0 0 14px;
  font-size: 17px;
}
.hot-search h2 span {
  color: var(--day-muted, #8fa497);
  font-size: 12px;
  font-weight: 400;
}
.hot-search-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hot-search-keywords button {
  max-width: 100%;
  padding: 7px 13px;
  border: 1px solid var(--day-line, #2a3a2e);
  border-radius: 999px;
  background: var(--day-surface-soft, #19281e);
  color: inherit;
  font: inherit;
  font-size: 14px;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.hot-search-keywords button:hover,
.hot-search-keywords button:focus-visible {
  border-color: var(--green);
}

.search-detail-heading {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 0 var(--list-right-inset) 8px 0;
}
.search-detail-cover {
  flex: 0 0 108px;
}
.search-detail-copy {
  min-width: 0;
  h2 {
    font-size: 24px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  p {
    margin-top: 4px;
    font-size: 13px;
  }
}
.search-detail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}
.search-detail-actions :deep(.el-button),
.search-detail-actions .detail-play-all.el-button {
  height: 30px;
  min-height: 30px;
  margin: 0;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
}
.detail-play-all :deep(span) {
  gap: 5px;
}
@media (max-width: 700px) {
  .search-detail-heading { gap: 12px; }
  .search-detail-cover { flex-basis: 84px; }
  .search-detail-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
    min-height: 84px;
  }
  .search-detail-copy h2 {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
    font-size: 15px;
    line-height: 17px;
  }
  .search-detail-copy p {
    max-width: 100%;
    overflow: hidden;
    margin: 3px 0 0;
    font-size: 12px;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .search-detail-actions { margin-top: auto; }
  .search-detail-actions :deep(.el-button),
  .search-detail-actions .detail-play-all.el-button {
    padding-inline: 8px;
    font-size: 12px;
  }
}
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
  background: transparent;
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
  .hot-search-keywords button:nth-child(n + 31) {
    display: none;
  }

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
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.online-search-form .search-input {
  box-sizing: border-box;
  flex: 0 1 280px;
  min-width: 0;
  height: 32px;
}

.online-search-form .primary.el-button {
  box-sizing: border-box;
  flex-shrink: 0;
  height: 32px;
  min-height: 32px;
  padding-block: 0;
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

.online-search > :not(.song-table, .hot-search) {
  flex-shrink: 0;
}
.search-input :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
.search-input :deep(.el-input__wrapper) {
  height: 30px;
  min-height: 0;
  box-shadow: none;
  background: transparent;
  padding: 0;
}
.search-input :deep(.el-input__inner) {
  width: 100%;
  height: 30px;
  font-size: 13px;
  padding: 0;
}
.online-search-form,
.platform-tabs,
.search-platform-errors {
  margin-right: var(--list-right-inset);
}
</style>
