<script setup lang="ts">
import ListSkeleton from "./ListSkeleton.vue";
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { nearScrollEnd, usePageScroll } from "../stores/usePageScroll";
import { usePagination } from "../stores/usePagination";
import ListPagination from "./ListPagination.vue";
import type { Track } from "../../../backend/src/contracts";
import {
  fileSize,
  platformName,
  variantQualityName,
  preferredVariant,
} from "../services/music";
import TrackCover from "./TrackCover.vue";
import TrackActions from "./TrackActions.vue";
import BatchTrackActions from "./BatchTrackActions.vue";
import ImportPlaylistButton from "./ImportPlaylistButton.vue";
import { requestApi as api } from "../services/api";
import AppIcon from "./AppIcon.vue";
const props = withDefaults(
  defineProps<{
    tracks: Track[];
    batch?: boolean;
    searchable?: boolean;
    disableAlbumLinks?: boolean;
    batchRemoveFavorites?: boolean;
    removeFromPlaylist?: (ids: string[]) => Promise<boolean>;
    currentId?: string;
    playing?: boolean;
    favoriteIds?: string[];
    removable?: boolean;
    paginate?: boolean;
    infinite?: boolean;
    hasMore?: boolean;
    loading?: boolean;
    loadingMore?: boolean;
    loadError?: string;
    rowOffset?: number;
  }>(),
  {
    playing: false,
    favoriteIds: () => [],
    removable: false,
    paginate: true,
    infinite: false,
    rowOffset: 0,
  },
);
const emit = defineEmits<{
  "load-more": [];
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  remove: [track: Track];
  notify: [message: string];
  navigate: [page: string];
}>();
const query = ref("");
const selectedIds = ref<string[]>([]);
const selecting = ref(false);
function toggleSelection() {
  selecting.value = !selecting.value;
  if (!selecting.value) selectedIds.value = [];
}
const selectedTracks = computed(() =>
  availableTracks.value.filter((track) => selectedIds.value.includes(track.id)),
);
const albumOpen = ref(false);
const albumLoading = ref(false);
const albumTitle = ref("");
const albumError = ref("");
const albumTracks = ref<Track[]>([]);
let albumRequest: AbortController | undefined;
function closeAlbum() {
  albumRequest?.abort();
  albumRequest = undefined;
}
onUnmounted(closeAlbum);
async function openAlbum(track: Track) {
  closeAlbum();
  const request = new AbortController();
  albumRequest = request;
  albumOpen.value = true;
  albumLoading.value = true;
  albumTitle.value = track.album;
  albumError.value = "";
  albumTracks.value = [];
  try {
    const data = await api(
      "/catalog/track-album/" + encodeURIComponent(track.id),
      { signal: request.signal },
    );
    if (!request.signal.aborted) albumTracks.value = data.tracks;
  } catch (error) {
    if (!request.signal.aborted)
      albumError.value =
        error instanceof Error ? error.message : "无法打开专辑";
  } finally {
    if (!request.signal.aborted) albumLoading.value = false;
  }
}
const deletedIds = ref<string[]>([]);
const availableTracks = computed(() => {
  if (!deletedIds.value.length) return props.tracks;
  const ids = new Set(deletedIds.value);
  return props.tracks.filter((track) => !ids.has(track.id));
});
const filteredTracks = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return availableTracks.value;
  return availableTracks.value.filter((track) =>
    [track.title, track.artist, track.album].some((value) =>
      value?.toLowerCase().includes(keyword),
    ),
  );
});
const filteredSelectedCount = computed(() => {
  const ids = new Set(selectedIds.value);
  return filteredTracks.value.filter((track) => ids.has(track.id)).length;
});
const allSelected = computed(
  () =>
    filteredTracks.value.length > 0 &&
    filteredSelectedCount.value === filteredTracks.value.length,
);
function selectAll(checked: boolean) {
  const ids = new Set(selectedIds.value);
  for (const track of filteredTracks.value) {
    if (checked) ids.add(track.id);
    else ids.delete(track.id);
  }
  selectedIds.value = [...ids];
}
function fileDeleted(event: Event) {
  deletedIds.value.push((event as CustomEvent<string>).detail);
}
onMounted(() => window.addEventListener("track-file-deleted", fileDeleted));
onUnmounted(() =>
  window.removeEventListener("track-file-deleted", fileDeleted),
);
const { currentPage, pageSize, total, offset, pagedItems, resize } =
  usePagination(filteredTracks);
watch(
  () => JSON.stringify(props.tracks.map((track) => track.id)),
  () => (currentPage.value = 1),
);
const loadedCount = ref(16);
const rows = ref<HTMLElement>();
const hasMore = computed(
  () => props.infinite && loadedCount.value < filteredTracks.value.length,
);
const visibleTracks = computed(() =>
  props.infinite
    ? filteredTracks.value.slice(0, loadedCount.value)
    : props.paginate
      ? pagedItems.value
      : filteredTracks.value,
);
watch(query, () => {
  currentPage.value = 1;
  loadedCount.value = 16;
  if (rows.value) rows.value.scrollTop = 0;
});
function loadMore() {
  const element = rows.value;
  if (!element || !props.infinite || element.clientHeight === 0) return;
  if (nearScrollEnd(element)) {
    if (hasMore.value) {
      loadedCount.value += 16;
      void nextTick(loadMore);
    } else if (props.hasMore && !props.loadingMore && !props.loadError) {
      emit("load-more");
    }
  }
}
usePageScroll(() => rows.value, loadMore);
let rowsObserver: ResizeObserver | undefined;
onMounted(() => {
  rowsObserver = new ResizeObserver(loadMore);
  if (rows.value) rowsObserver.observe(rows.value);
  void nextTick(loadMore);
});
watch(rows, (element, previous) => {
  if (previous) rowsObserver?.unobserve(previous);
  if (element) rowsObserver?.observe(element);
});
onUnmounted(() => rowsObserver?.disconnect());
watch(
  [
    () => availableTracks.value.length,
    () => props.hasMore,
    () => props.loadingMore,
  ],
  () => {
    void nextTick(loadMore);
  },
);
const startIndex = computed(() =>
  props.infinite
    ? props.rowOffset
    : props.paginate
      ? offset.value
      : props.rowOffset,
);
function playRow(track: Track) {
  if (selecting.value) {
    selectedIds.value = selectedIds.value.includes(track.id)
      ? selectedIds.value.filter((id) => id !== track.id)
      : [...selectedIds.value, track.id];
    return;
  }
  if (!track.available) return;
  emit("play", track, props.tracks);
}
function action(kind: string, track: Track) {
  if (kind === "play") emit("play", track, availableTracks.value);
  else if (kind === "favorite") emit("favorite", track);
  else if (kind === "remove") emit("remove", track);
  else emit("enqueue", track, kind === "next");
}
function clock(seconds: number) {
  return `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, "0")}`;
}
</script>
<template>
  <div
    class="track-list song-table"
    :class="{ 'infinite-song-table': infinite }"
  >
    <div
      v-if="
        searchable ||
        $slots.actions ||
        $slots.search
      "
      class="song-toolbar"
    >
      <div class="song-batch-toolbar">
        <slot name="actions" />
      </div>
      <div v-if="searchable || $slots.search" class="song-toolbar-search">
        <slot name="search">
          <el-input
            v-model="query"
            :disabled="!tracks.length"
            clearable
            aria-label="搜索当前列表"
            placeholder="搜索歌曲、歌手、专辑"
          >
            <template #prefix><AppIcon name="搜索" :size="16" /></template>
          </el-input>
        </slot>
      </div>
    </div>
    <ListSkeleton
      v-if="loading && !tracks.length"
      class="song-table-rows"
      label="正在加载歌曲"
    />
    <slot v-else-if="!tracks.length && $slots.empty" name="empty" />
    <template v-else>
      <div
        class="table-header online-track-row"
        :class="{ 'selection-header': batch }"
      >
        <el-checkbox
          v-if="selecting"
          class="track-selection"
          :model-value="allSelected"
          :indeterminate="filteredSelectedCount > 0 && !allSelected"
          :disabled="!filteredTracks.length"
          :aria-label="allSelected ? '取消全选' : '全选列表'"
          @change="selectAll($event === true)"
        />
        <span v-else class="track-number">#</span>
        <div v-if="selecting" class="selection-actions">
          <span aria-live="polite">已选 {{ selectedTracks.length }} 首</span>
          <BatchTrackActions
            :tracks="selectedTracks"
            :remove-favorites="batchRemoveFavorites"
            :remove-from-playlist="removeFromPlaylist"
            @done="selectedIds = []"
          />
        </div>
        <template v-else>
          <div class="track-info">歌曲 / 音质</div>
          <span class="album">专辑</span>
          <span class="audio-spec">格式 / 大小</span>
          <span class="track-time">时长</span>
          <span class="track-action-heading">收藏</span>
          <span v-if="!batch" class="track-action-heading">更多</span>
        </template>
        <button
          v-if="batch"
          type="button"
          class="selection-toggle"
          :disabled="!selecting && !tracks.length"
          :aria-label="selecting ? '退出多选' : '开启多选'"
          :title="selecting ? '退出多选' : '开启多选'"
          @click="toggleSelection"
        >
          <AppIcon v-if="selecting" name="check" :size="17" />
          <svg
            v-else
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m1.5 3.5 1.25 1.25L5 2.5M7.5 3.5h9m-15 5.5 1.25 1.25L5 8m2.5 1h9m-15 5.5 1.25 1.25L5 13.5m2.5 1h9" />
          </svg>
        </button>
      </div>
      <div
        ref="rows"
        class="song-table-rows"
        @scroll.passive="loadMore"
        tabindex="0"
        aria-label="歌曲列表"
      >
        <div
          v-for="(track, index) in visibleTracks"
          :key="track.id"
          class="track-row online-track-row"
          :class="{
            selected: currentId === track.id,
            unavailable: !track.available,
            'track-row-checked': selecting && selectedIds.includes(track.id),
          }"
          @click="$event.detail <= 1 && playRow(track)"
        >
          <el-checkbox
            v-if="selecting"
            v-model="selectedIds"
            class="track-selection"
            :value="track.id"
            :aria-label="'选择 ' + track.title"
            @click.stop
          />
          <span v-else class="track-number">{{ startIndex + index + 1 }}</span>
          <div class="track-info">
            <TrackCover
              :track="track"
              :playback="track.available && !selecting"
              :playable="track.available && !selecting"
              :playing="currentId === track.id && playing"
              @play="playRow(track)"
            />
            <div class="track-copy">
              <div class="track-heading">
                <span class="track-title" :title="track.title">{{
                  track.title
                }}</span
                ><span v-if="preferredVariant(track)" class="quality-badge">{{
                  variantQualityName(preferredVariant(track))
                }}</span>
              </div>
              <small
                >{{ track.artist
                }}<span
                  class="platform-badge"
                  :data-platform="track.online ? track.platform : 'local'"
                  >{{
                    track.online
                      ? platformName(track.platform)
                      : track.available
                        ? "本地"
                        : "文件失效"
                  }}</span
                ></small
              >
              <button
                v-if="
                  !disableAlbumLinks &&
                  track.album?.trim() &&
                  track.album !== '未知专辑'
                "
                type="button"
                class="album-link album-link-compact"
                :title="track.album"
                @click.stop="openAlbum(track)"
                @dblclick.stop
              >
                {{ track.album }}
              </button>
            </div>
          </div>

          <button
            v-if="
              !disableAlbumLinks &&
              track.album?.trim() &&
              track.album !== '未知专辑'
            "
            type="button"
            class="album album-link"
            :title="track.album"
            @click.stop="openAlbum(track)"
            @dblclick.stop
          >
            {{ track.album }}
          </button>
          <span v-else class="album" :title="track.album">{{
            track.album
          }}</span>
          <div
            class="audio-spec"
            :title="
              track.audioVariants
                ?.map((v) =>
                  [
                    variantQualityName(v),
                    v.quality === 'local' ? '' : v.format,
                    fileSize(v.size),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                )
                .join('\n')
            "
          >
            <strong>{{
              preferredVariant(track)?.format || track.format || "格式未知"
            }}</strong
            ><small>{{
              fileSize(preferredVariant(track)?.size || track.size)
            }}</small>
          </div>
          <span class="track-time">{{ clock(track.duration) }}</span>
          <el-button
            class="icon-button favorite"
            :class="{ liked: favoriteIds.includes(track.id) }"
            :aria-label="favoriteIds.includes(track.id) ? '取消收藏' : '收藏'"
            @click.stop="emit('favorite', track)"
            @dblclick.stop
            text
            ><AppIcon
              name="heart"
              :size="17"
              :fill="favoriteIds.includes(track.id) ? 'currentColor' : 'none'"
          /></el-button>
          <TrackActions
            :track="track"
            :favorite="favoriteIds.includes(track.id)"
            :removable="removable"
            @action="action($event, track)"
            @notify="emit('notify', $event)"
            @navigate="emit('navigate', $event)"
          />
        </div>
        <div
          v-if="query.trim() && !filteredTracks.length"
          class="scroll-load-status"
          role="status"
        >
          没有找到匹配的歌曲
        </div>
        <ListSkeleton v-if="loadingMore" :count="2" label="正在加载更多歌曲" />
        <div
          v-else-if="infinite && loadError"
          class="scroll-load-status"
          role="status"
        >
          <span>{{ loadError }}</span>
          <el-button @click="emit('load-more')" text>重试</el-button>
        </div>
      </div>
      <ListPagination
        v-if="paginate && !infinite"
        v-model:page="currentPage"
        :page-size="pageSize"
        :total="total"
        @update:page-size="resize"
      />
    </template>
  </div>
  <el-dialog
    v-if="!disableAlbumLinks"
    v-model="albumOpen"
    :title="albumTitle"
    width="min(960px, 94vw)"
    append-to-body
    destroy-on-close
    @close="closeAlbum"
  >
    <ListSkeleton v-if="albumLoading" label="正在读取专辑曲目" />
    <p v-else-if="albumError" role="alert">{{ albumError }}</p>
    <p v-else-if="!albumTracks.length">这张专辑暂无曲目</p>
    <div v-else class="album-dialog-content">
      <div class="song-batch-toolbar">
        <el-button
          type="primary"
          @click="emit('play', albumTracks[0], albumTracks)"
          >播放全部</el-button
        >
        <ImportPlaylistButton :name="albumTitle" :tracks="albumTracks" />
        <BatchTrackActions :tracks="albumTracks" whole-album />
      </div>
      <SongTable
        :tracks="albumTracks"
        :current-id="currentId"
        :playing="playing"
        :favorite-ids="favoriteIds"
        disable-album-links
        :paginate="false"
        @play="(track, list) => emit('play', track, list)"
        @favorite="emit('favorite', $event)"
        @enqueue="(track, next) => emit('enqueue', track, next)"
        @notify="emit('notify', $event)"
        @navigate="emit('navigate', $event)"
      />
    </div>
  </el-dialog>
</template>

<style scoped lang="scss">
.table-header,
.track-row {
  display: grid;
  grid-template-columns:
    35px minmax(170px, 1fr) minmax(110px, 0.6fr)
    65px 42px 50px;
  align-items: center;
  gap: 14px;
  padding: 0 14px;
}

.table-header {
  height: 38px;
  color: var(--day-muted, #586d5f);
  font-size: 12px;
  border-bottom: 1px solid var(--day-line, #28332b);
  margin-bottom: 8px;
}

.table-header span:last-child {
  text-align: right;
}

.track-row {
  min-height: 66px;
  border-radius: 7px;
}

.track-row.selected {
  // background: var(--day-surface-soft, #1c2e22);
}

.track-row.selected .track-title,
.track-row.selected .track-number {
  color: var(--green);
}

.track-row.unavailable {
  opacity: 0.45;
}

.track-info {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}

.track-info > div:last-child {
  min-width: 0;
}

.track-title {
  font-size: 14px;
  padding: 0;
  max-width: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  display: block;
  text-align: left;
}

.track-info small {
  display: block;
  color: var(--day-muted, #74877c);
  font-size: 11px;
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyric-badge {
  font-size: 12px;
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 7px;
  border: 1px solid var(--day-line, #2a4935);
  color: var(--day-muted, #6b9d7d);
}

.lyric-badge {
  margin-left: 4px;
  border-color: var(--day-line, #36433a);
  color: var(--day-muted, #85958b);
}

.album {
  min-width: 0;
  text-align: left;
  color: var(--day-muted, #7d9083);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.album.album-link {
  display: block;
}

.icon-button {
  color: var(--day-muted, #87998d);
  position: relative;
  padding: 7px;
  border-radius: 5px;
  flex-shrink: 0;
  font-size: 22px;
  line-height: 1;
}

.icon-button:hover {
  color: var(--day-text, #dcebe1);
  background: var(--day-surface-soft, #26332b);
}

.liked {
  color: var(--green) !important;
}

.track-time {
  font-size: 12px;
  color: var(--day-muted, #8b9e91);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .table-header,
  .track-row {
    grid-template-columns:
      25px minmax(140px, 1fr) minmax(85px, 0.5fr)
      50px 28px 35px;
    gap: 10px;
    padding: 0 8px;
  }
}

@media (max-width: 700px) {
  .table-header:not(.selection-header) {
    display: none;
  }

  .track-row {
    grid-template-columns: 20px minmax(90px, 1fr) 25px;
    gap: 7px;
    min-height: 70px;
  }

  .track-row .album,
  .track-row :deep(.format),
  .track-row .track-time {
    display: none;
  }

  .track-info {
    gap: 9px;
  }

  .track-info :deep(.cover) {
    width: 36px;
    height: 36px;
  }

  .track-title {
    font-size: 13px;
  }

  .track-info small {
    font-size: 11px;
  }
}
.online-track-row {
  grid-template-columns:
    28px minmax(220px, 1.3fr) minmax(100px, 0.7fr)
    108px 30px 30px 42px;
  gap: 12px;
}

.track-copy {
  flex: 1;
  min-width: 0;
}

.track-heading {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.track-heading .track-title {
  min-width: 0;
  flex-shrink: 1;
}

.quality-badge {
  color: var(--quality-badge-text);
  background: var(--quality-badge-surface);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}

.platform-badge {
  display: inline-block;
  margin-left: 7px;
  padding: 0px 5px;
  border-radius: 3px;
  color: var(--day-muted, #a8b4e1);
  background: var(--day-surface-soft, #262c40);
  font-size: 12px;
}

.platform-badge[data-platform="wy"] {
  color: var(--day-danger-text, #ee8e8e);
  background: var(--day-rose, #3c1d22);
}

.platform-badge[data-platform="kw"] {
  color: var(--day-text, #d7c982);
  background: var(--day-amber, #3a341d);
}

.platform-badge[data-platform="kg"] {
  color: var(--day-muted, #7fbfe8);
  background: var(--day-surface-soft, #1b3443);
}

.platform-badge[data-platform="mg"] {
  color: var(--day-danger-text, #e59dbf);
  background: var(--day-rose, #3e2231);
}

.audio-spec strong {
  display: block;
  color: var(--day-muted, #9bb5a5);
  font-size: 12px;
  font-weight: 400;
}

.audio-spec small {
  display: block;
  margin-top: 5px;
  color: var(--day-muted, #647c6d);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .online-track-row {
    grid-template-columns:
      22px minmax(150px, 1fr) minmax(75px, 0.5fr)
      75px 26px 26px 35px;
    gap: 8px;
  }
}

@media (max-width: 700px) {
  .online-track-row {
    grid-template-columns: 19px minmax(0, 1fr) 27px 27px;
    gap: 5px;
  }

  .online-track-row .audio-spec,
  .online-track-row .album,
  .online-track-row .track-time {
    display: none;
  }

  .online-track-row .quality-badge {
    font-size: 12px;
    padding: 2px 4px;
  }

  .online-track-row .track-heading {
    gap: 5px;
  }
}

.song-table {
  container-type: inline-size;
  min-width: 0;
}

.platform-badge[data-platform="local"] {
  color: var(--day-muted, #83bb93);
  background: var(--day-selected, #213b29);
}

.song-table .table-header .album,
.song-table .table-header .track-time {
  font-size: inherit;
  color: inherit;
}

@container (max-width: 700px) {
  .song-table .online-track-row {
    grid-template-columns:
      22px minmax(100px, 1fr) minmax(65px, 0.5fr)
      70px 26px 26px 35px;
    gap: 7px;
  }
}

@container (max-width: 540px) {
  .song-table .online-track-row {
    grid-template-columns: 19px minmax(0, 1fr) 27px 27px;
    gap: 5px;
  }

  .song-table .online-track-row .audio-spec,
  .song-table .online-track-row .album,
  .song-table .online-track-row .track-time {
    display: none;
  }
}

@media (max-width: 700px) {
  .song-table .online-track-row {
    grid-template-columns: 19px minmax(0, 1fr) 27px 27px;
    gap: 5px;
  }
}

.song-table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.song-table > .table-header,
.song-table > :deep(.list-pagination) {
  flex-shrink: 0;
}

.song-table-rows {
  padding-bottom: var(--list-bottom-padding, 0px);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

.song-table-rows {
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
}

@keyframes pulse {
  to {
    opacity: 0.4;
  }
}

.icon-button.el-button {
  border: 0;
  background: none;
  margin: 0;
  height: auto;
}
.icon-button.el-button > :deep(span) {
  display: contents;
}
.icon-button.el-button {
  padding: 7px;
  color: var(--day-muted, #87998d);
}
.icon-button.el-button:hover {
  background: var(--day-surface-soft, #26332b);
  color: var(--day-text, #dcebe1);
}
.song-table .table-header {
  box-sizing: border-box;
  height: 46px;
  padding-block: 0;
  font-size: 13px;
  color: var(--day-muted, #a4b5aa);
}
.song-table .track-row {
  min-height: var(--song-row-height);
  padding-block: 4px;
  border-radius: var(--song-row-radius);
}

.song-table .track-info small {
  margin-top: 2px;
}
.track-title {
  font-size: 15px;
  line-height: 1.5;
  font-weight: 500;
}
.track-info small {
  font-size: 11px;
  line-height: 1.5;
  margin-top: 4px;
  color: var(--day-muted, #a2b3a8);
}
.album {
  font-size: 14px;
  color: var(--day-muted, #a9b9af);
}
.track-time,
.track-number {
  font-size: 13px;
  color: var(--day-muted, #a7b8ad);
}
.audio-spec strong {
  font-size: 13px;
  color: var(--day-text, #b4c9bc);
  line-height: 1.4;
}
.audio-spec small {
  font-size: 12px;
  color: var(--day-muted, #9bad9f);
  line-height: 1.4;
  margin-top: 3px;
}
.lyric-badge {
  color: var(--day-text, #a8c8b2);
}
.song-table .online-track-row {
  grid-template-columns:
    28px minmax(220px, 1.3fr) minmax(100px, 0.7fr)
    108px 60px 36px 36px;
  gap: 12px;
}
.song-table > .table-header,
.song-table-rows {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}
.song-table > .table-header {
  overflow-y: hidden;
}
.song-table .track-time {
  text-align: left;
  justify-self: start;
}
.song-table .audio-spec {
  min-width: 0;
  text-align: left;
  justify-self: start;
}
.song-table .track-action-heading {
  text-align: center;
  font-size: 12px;
}
// .song-table .track-row.selected {
//   background: var(--song-row-highlight);
//   box-shadow: inset 3px 0 #62e393;
// }
.song-table .track-row.selected .track-title {
  color: var(--day-accent-text, #8bf1ae);
}
.song-table .track-row.selected .album,
.song-table .track-row.selected .track-time {
  color: var(--day-text, #d4e9dc);
}
@media (max-width: 1100px) {
  .song-table .online-track-row {
    grid-template-columns:
      22px minmax(150px, 1fr) minmax(75px, 0.5fr)
      85px 52px 32px 32px;
    gap: 8px;
  }
}
@container (max-width:700px) {
  .song-table .online-track-row {
    grid-template-columns:
      22px minmax(100px, 1fr) minmax(65px, 0.5fr)
      80px 48px 30px 30px;
    gap: 7px;
  }
}
@container (max-width:540px) {
  .song-table .online-track-row {
    grid-template-columns: 19px minmax(0, 1fr) 30px 30px;
    gap: 5px;
  }
}
@media (max-width: 700px) {
  .song-table .table-header,
  .song-table .track-row {
    padding: 0 8px;
  }
  .song-table .online-track-row {
    grid-template-columns: 19px minmax(0, 1fr) 30px 30px;
    gap: 5px;
  }
}
.song-table .track-row:not(.unavailable) {
  cursor: pointer;
}
.song-table .track-row {
  transition: background-color 0.15s;
}
@media (hover: hover) and (pointer: fine) {
  .song-table .track-row:hover {
    background: var(--song-row-highlight);
  }
  .song-table .track-row:not(.selected):hover .track-number,
  .song-table .track-row:not(.selected):hover .track-title {
    color: var(--song-row-hover-title);
  }
  .song-table .track-row:not(.selected):hover .track-info small,
  .song-table .track-row:not(.selected):hover .album,
  .song-table .track-row:not(.selected):hover .track-time,
  .song-table .track-row:not(.selected):hover .audio-spec strong,
  .song-table .track-row:not(.selected):hover .audio-spec small {
    color: var(--song-row-hover-text);
  }

  .track-row:hover :deep(.cover-playback) {
    opacity: 1;
  }
}

.track-number {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.track-selection.el-checkbox {
  display: grid;
  place-items: center;
  justify-self: center;
  width: 24px;
  height: 28px;
  margin: 0;
  padding: 0;
}
.track-selection :deep(.el-checkbox__label) {
  display: none;
}

.selection-actions {
  grid-column: 2 / -2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px 10px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.selection-actions > span {
  white-space: nowrap;
}
.selection-actions :deep(.batch-track-actions) {
  flex: none;
  flex-wrap: nowrap;
  gap: 4px;
}
.selection-actions :deep(.batch-track-actions > .el-button) {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
}
.selection-toggle {
  grid-column: -2 / -1;
  justify-self: center;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.selection-toggle:hover:not(:disabled) {
  background: var(--day-surface-soft, #26332b);
  color: var(--day-text, #dcebe1);
}
.selection-toggle:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 700px) {
  .song-table .track-row {
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none;
    user-select: none;
  }
  .song-table .online-track-row > .track-number {
    display: none;
  }
  .song-table .track-row,
  .song-table .table-header:not(:has(> .track-selection)) {
    grid-template-columns: minmax(0, 1fr) 30px 30px;
  }
  .song-table .track-row > .track-selection {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .song-table .track-row.track-row-checked :deep(.cover) {
    outline: 1px solid var(--green);
  }
  .song-table .track-row:has(> .track-selection :focus-visible) {
    outline: 2px solid var(--green);
    outline-offset: -2px;
  }
  .selection-header .track-action-heading {
    display: none;
  }
}

.scroll-load-status {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 16px;
  color: var(--day-muted, #8eaa98);
  font-size: 13px;
}
.song-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-block: 8px;
}
.song-batch-toolbar > :deep(.el-button) {
  margin: 0;
}
.song-toolbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px 16px;
  padding-block: 8px;
}
.song-toolbar .song-batch-toolbar {
  min-width: 0;
  padding: 0;
}
.song-toolbar .song-batch-toolbar > :deep(.el-button),
.song-toolbar .song-batch-toolbar :deep(.batch-track-actions > .el-button) {
  height: 32px;
  min-height: 32px;
  padding: 0 15px;
  font-size: 14px;
}
.song-toolbar-search :deep(.el-input__wrapper) {
  min-height: 32px;
}
.song-toolbar-search :deep(.search-input) {
  height: 32px;
}
.song-toolbar-search :deep(.search-input .el-input__wrapper),
.song-toolbar-search :deep(.search-input .el-input__inner),
.song-toolbar-search :deep(.search-input > .el-button) {
  min-height: 0;
  height: 30px;
}
.song-toolbar-search :deep(.search-input > .el-button) {
  padding-block: 0;
}
.song-toolbar-search {
  flex: 0 1 280px;
  min-width: 150px;
  margin-inline-start: auto;
}
@container (max-width: 540px) {
  .song-toolbar {
    flex-wrap: wrap;
  }
  .song-toolbar-search {
    min-width: min(150px, 100%);
  }
}
.album-link {
  text-align: left;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.album-link:hover,
.album-link:focus-visible {
  color: var(--green);
  text-decoration: underline;
}
.album-dialog-content {
  display: flex;
  flex-direction: column;
  max-height: 65vh;
  min-height: 0;
}
.album-dialog-content > .song-table {
  min-height: 0;
}
.album-link-compact {
  display: none;
}
@container (max-width: 540px) {
  .album-link-compact {
    display: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }
}
@media (max-width: 700px) {
  .album-link-compact {
    display: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }
}
@media (max-width: 700px) {
  .song-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .song-toolbar-search {
    flex: none;
    min-width: 0;
    margin: 0;
  }
}
</style>
