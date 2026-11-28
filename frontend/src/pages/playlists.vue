<script setup lang="ts">
import { isAndroidOnline } from "../services/platform";
import { ElMessageBox } from "element-plus";
import ListSkeleton from "../components/ListSkeleton.vue";
import {
  computed,
  onActivated,
  onDeactivated,
  onUnmounted,
  ref,
  watch,
} from "vue";
import type { Track } from "../../../backend/src/contracts";
import { route, navigate } from "../services/router";
import { requestApi as api } from "../services/api";
import { confirmAction } from "../services/dialog";
import { reportError } from "../services/feedback";
import { library, refreshLibrary } from "../stores/library";
import PageLayout from "../components/PageLayout.vue";
import CatalogDetailToolbar from "../components/CatalogDetailToolbar.vue";
import SongTable from "../components/SongTable.vue";
import PlaylistCard from "../components/PlaylistCard.vue";
import PlaylistCover from "../components/PlaylistCover.vue";
import AppIcon from "../components/AppIcon.vue";
defineOptions({ name: "playlists" });
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
interface Playlist {
  id: string;
  name: string;
  count: number;
  trackIds: string[];
}
const playlists = ref<Playlist[]>([]),
  name = ref(""),
  createOpen = ref(false),
  nameInput = ref<{ focus: () => void }>(),
  tracks = ref<Track[]>([]),
  detail = ref<Playlist>(),
  busy = ref(false),
  detailLoading = ref(false),
  directoryLoading = ref(false),
  detailError = ref(""),
  directoryError = ref(""),
  playingPlaylist = ref("");
const selected = computed(() =>
  route.value.page === "我的歌单" ? route.value.id : "",
);
const trackIndex = computed(
  () =>
    new Map(
      [...library.value.tracks, ...(library.value.onlineTracks || [])].map(
        (track) => [track.id, track],
      ),
    ),
);
const detailCover = computed(() => {
  const id = detail.value?.trackIds[0];
  return id
    ? trackIndex.value.get(id) || tracks.value.find((track) => track.id === id)
    : undefined;
});
let controller: AbortController | undefined;
async function load() {
  directoryLoading.value = true;
  directoryError.value = "";
  try {
    playlists.value = await api("/playlists");
  } catch (error) {
    directoryError.value =
      error instanceof Error ? error.message : "歌单加载失败";
  } finally {
    directoryLoading.value = false;
  }
}
async function open(id: string) {
  controller?.abort();
  const active = new AbortController();
  controller = active;
  detailLoading.value = true;
  detailError.value = "";
  tracks.value = [];
  detail.value = playlists.value.find((item) => item.id === id);
  try {
    const result = await api("/playlists/" + encodeURIComponent(id), {
      signal: active.signal,
    });
    if (controller !== active || selected.value !== id) return;
    tracks.value = isAndroidOnline ? result.tracks.filter((track: Track) => track.online) : result.tracks;
    detail.value = { ...result, count: isAndroidOnline ? tracks.value.length : result.trackIds.length };
  } catch (error) {
    if (!active.signal.aborted && controller === active)
      detailError.value =
        error instanceof Error ? error.message : "歌单加载失败";
  } finally {
    if (controller === active) detailLoading.value = false;
  }
}
function openCreate() {
  name.value = "";
  createOpen.value = true;
}
async function create() {
  if (!name.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api("/playlists", {
      method: "POST",
      body: JSON.stringify({ name: name.value.trim() }),
    });
    createOpen.value = false;
    await load();
  } catch (error) {
    reportError(error);
  } finally {
    busy.value = false;
  }
}
async function remove(item: Playlist) {
  if (
    !(await confirmAction(
      "删除歌单「" + item.name + "」？不会删除原始歌曲文件。",
    ))
  )
    return;
  try {
    await api("/playlists/" + encodeURIComponent(item.id), {
      method: "DELETE",
    });
    if (selected.value === item.id) navigate("我的歌单");
    await load();
  } catch (error) {
    reportError(error);
  }
}
async function rename(item: Playlist) {
  const result = await ElMessageBox.prompt("输入新的歌单名称", "重命名歌单", {
    inputValue: item.name,
    inputValidator: value => !!value?.trim() && value.trim().length <= 80 || "歌单名称需要为 1–80 字",
    confirmButtonText: "保存",
    cancelButtonText: "取消",
    closeOnClickModal: false,
  }).catch(() => null);
  if (!result || result.value.trim() === item.name) return;
  try {
    const updated = await api("/playlists/" + encodeURIComponent(item.id), {
      method: "PATCH",
      body: JSON.stringify({ name: result.value.trim() }),
    });
    playlists.value = playlists.value.map(playlist =>
      playlist.id === item.id ? { ...playlist, name: updated.name } : playlist,
    );
  } catch (error) {
    reportError(error);
  }
}
async function removePlaylistTracks(trackIds: string[]) {
  const id = selected.value;
  if (!id || !trackIds.length) return false;
  if (!(await confirmAction("从当前歌单移除选中的 " + trackIds.length + " 首歌曲？"))) return false;

  try {
    for (let index = 0; index < trackIds.length; index += 200) {
      await api("/playlists/" + encodeURIComponent(id) + "/tracks/remove-batch", {
        method: "POST",
        body: JSON.stringify({ trackIds: trackIds.slice(index, index + 200) }),
      });
    }
    emit("notify", "已从歌单移除所选歌曲");
    return true;
  } finally {
    if (selected.value === id) await open(id);
    await load();
  }
}
async function removeSong(track: Track) {
  if (!selected.value) return;
  try {
    const id = selected.value;
    await api(
      "/playlists/" +
        encodeURIComponent(id) +
        "/tracks/" +
        encodeURIComponent(track.id),
      { method: "DELETE" },
    );
    if (selected.value === id) await open(id);
    await load();
  } catch (error) {
    reportError(error);
  }
}
async function playPlaylist(item: Playlist) {
  if (!item.count || playingPlaylist.value) return;
  playingPlaylist.value = item.id;
  try {
    const result = await api("/playlists/" + encodeURIComponent(item.id));
    if (result.tracks.length) emit("play", result.tracks[0], result.tracks);
    else emit("notify", "歌单暂无可用歌曲");
  } catch (error) {
    reportError(error);
  } finally {
    playingPlaylist.value = "";
  }
}
watch(
  route,
  () => {
    if (route.value.page !== "我的歌单") return;
    if (selected.value) void open(selected.value);
    else {
      controller?.abort();
      detail.value = undefined;
      tracks.value = [];
      detailLoading.value = false;
      void load();
    }
  },
  { immediate: true },
);
onActivated(() => {
  void load();
  void refreshLibrary();
});
onDeactivated(() => controller?.abort());
onUnmounted(() => controller?.abort());
</script>
<template>
  <PageLayout title="我的歌单" floating>
    <template v-if="selected" #detail-toolbar>
      <CatalogDetailToolbar
        :loading="detailLoading"
        back-label="返回我的歌单"
        @back="navigate('我的歌单')"
        @refresh="open(selected)"
      />
    </template>
    <div class="playlists-page">
      <template v-if="!selected">
        <div class="directory-toolbar">
          <el-button type="primary" class="primary new-playlist" @click="openCreate">
            <AppIcon name="plus" :size="16" />新建歌单
          </el-button>
        </div>
        <el-dialog
          v-model="createOpen"
          title="新建歌单"
          width="min(420px, 92vw)"
          append-to-body
          :close-on-click-modal="!busy"
          :close-on-press-escape="!busy"
          :show-close="!busy"
          @opened="nameInput?.focus()"
        >
          <el-form class="playlist-create" @submit.prevent="create">
            <el-input
              ref="nameInput"
              v-model="name"
              :disabled="busy"
              maxlength="80"
              placeholder="输入新歌单名称"
              aria-label="新歌单名称"
            />
            <div class="playlist-create-actions">
              <el-button :disabled="busy" @click="createOpen = false">取消</el-button>
              <el-button
                type="primary"
                :loading="busy"
                :disabled="busy || !name.trim()"
                native-type="submit"
              >创建</el-button>
            </div>
          </el-form>
        </el-dialog>
        <div v-if="directoryError" class="page-state" role="alert">
          <p>{{ directoryError }}</p>
          <el-button @click="load">重试</el-button>
        </div>
        <div v-else-if="directoryLoading && !playlists.length" class="playlist-directory">
          <ListSkeleton class="playlist-grid" layout="covers" label="正在加载歌单" />
        </div>
        <div v-else-if="!playlists.length" class="page-state">
          <AppIcon name="我的歌单" :size="44" />
          <h2>创建你的第一张歌单</h2>
          <p>在上方新建歌单，把喜欢的音乐慢慢收集起来。</p>
        </div>
        <div v-else class="playlist-directory" aria-label="我的歌单列表">
          <div class="playlist-grid">
            <PlaylistCard
              v-for="item in playlists"
              :key="item.id"
              :name="item.name"
              :count="item.count"
              :first-track="trackIndex.get(item.trackIds[0])"
              :loading="playingPlaylist === item.id"
              @open="navigate('我的歌单', 'wy', item.id)"
              @play="playPlaylist(item)"
              @rename="rename(item)"
              @remove="remove(item)"
            />
          </div>
        </div>
      </template>
      <template v-else>
        <div class="detail-toolbar">
          <PlaylistCover class="detail-cover" :track="detailCover" :empty="detail?.count === 0" />
          <div class="detail-summary">
            <h2 :title="detail?.name">{{ detail?.name || "歌单" }}</h2>
            <p>{{ detail?.count || 0 }} 首歌曲</p>
            <el-button
              class="primary detail-play-all"
              type="primary"
              :disabled="!tracks.length || detailLoading"
              @click="emit('play', tracks[0], tracks)"
            ><AppIcon name="play" :size="14" />播放全部</el-button>
          </div>
        </div>
        <SongTable
          batch
          :key="selected"
          :tracks="tracks"
          :loading="detailLoading"
          infinite
          :current-id="props.currentId"
          :playing="props.playing"
          :favorite-ids="props.favoriteIds"
          removable
          @play="(track, list) => emit('play', track, list)"
          @favorite="emit('favorite', $event)"
          @enqueue="(track, next) => emit('enqueue', track, next)"
          :remove-from-playlist="removePlaylistTracks"
          @remove="removeSong"
          @notify="emit('notify', $event)"
          @navigate="emit('navigate', $event)"
        >
          <template #empty>
            <div v-if="detailError" class="page-state" role="alert">
              <p>{{ detailError }}</p>
              <el-button @click="open(selected)">重试</el-button>
            </div>
            <div v-else class="empty-playlist">
              <PlaylistCover
                class="empty-playlist-background"
                :track="detailCover"
                :empty="!detail?.count"
              />
              <div class="empty-playlist-copy">
                
                <p>
                  {{
                    detail?.count
                      ? "可以在设置中检查音乐目录，或添加其他歌曲。"
                      : "歌单还是空的，去发现让你心动的音乐吧。"
                  }}
                </p>
                <el-button class="empty-search" @click="emit('navigate', '搜索')"
                  ><AppIcon name="搜索" :size="16" />去搜索音乐</el-button
                >
              </div>
            </div>
          </template>
        </SongTable>
      </template>
    </div>
  </PageLayout>
</template>
<style scoped lang="scss">
.playlists-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.directory-toolbar {
  display: flex;
  align-items: center;
  margin: 0 var(--list-right-inset) 26px 0;
  flex-shrink: 0;
}
.directory-toolbar .new-playlist {
  min-height: 32px;
  height: 32px;
  padding-block: 0;
}
.playlist-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.playlist-create-actions > :deep(.el-button) {
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  min-width: 64px;
  margin: 0;
  padding-block: 0;
}
.playlist-create :deep(.el-input__wrapper) {
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  padding-block: 0;
}
.playlist-create :deep(.el-input__inner) {
  height: 30px;
}
.primary {
  min-height: 38px;
  border: 0;
  border-radius: 8px;
  padding: 10px 16px;
  background: var(--green);
  color: var(--day-on-accent, #072512);
  font-weight: 600;
}
.secondary {
  background: var(--day-surface-soft, #18271e);
  border: 1px solid var(--day-line, #344239);
  color: var(--day-text, #b8c8be);
}
.playlist-directory {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
  padding: 2px var(--list-right-inset) var(--list-bottom-padding) 2px;
}
.playlist-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
  gap: 28px 22px;
  align-content: start;
}
.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-shrink: 0;
  margin: 0 var(--list-right-inset) 8px 0;
}
.detail-cover {
  flex: 0 0 108px;
  width: 108px;
}
.detail-summary {
  min-width: 0;
  flex: 1;
  h2 {
    font-size: 24px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  p {
    font-size: 13px;
    margin-top: 4px;
    color: var(--day-muted, #8fa797);
  }
}
.detail-summary .detail-play-all.el-button {
  width: 104px;
  height: 30px;
  min-height: 30px;
  margin-top: 12px;
  padding: 0;
  border-radius: 999px;
  font-size: 13px;
}
.detail-play-all :deep(span) {
  gap: 5px;
}
.page-state {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px var(--list-right-inset) var(--list-bottom-padding) 0;
  color: var(--day-muted, #8ba693);
  text-align: center;
  h2 {
    color: var(--day-text, #dae8df);
  }
  p {
    font-size: 14px;
  }
}
.empty-playlist {
  position: relative;
  flex: 1;
  min-height: 260px;
  margin: 0 var(--list-right-inset) calc(var(--player-height) + 24px) 0;
  overflow: hidden;
  border-radius: 16px;
}
.empty-playlist-background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: inherit;
  :deep(.cover-heart) {
    top: 34%;
  }
  :deep(.heart-icon) {
    width: 72px;
    height: 72px;
  }
}
.empty-playlist-copy {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 28px;
  text-align: center;
  h2 {
    color: var(--day-text, #e4eee5);
    font-size: 23px;
    font-weight: 600;
  }
  p {
    margin: 8px 0 20px;
    color: var(--day-text, #b4caba);
    font-size: 14px;
  }
}
.empty-search.el-button {
  border: 1px solid #7eac894d;
  background: var(--day-selected, #294737);
  color: var(--day-text, #cce5d1);
  font-weight: 600;
}
@media (max-width: 700px) {
  .directory-toolbar {
    margin-bottom: 20px;
  }
  .playlist-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 130px), 1fr));
    gap: 22px 14px;
  }
  .detail-toolbar {
    gap: 12px;
  }
  .detail-cover {
    flex-basis: 84px;
    width: 84px;
  }
  .detail-summary {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
    min-height: 84px;
  }
  .detail-summary h2 {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
    font-size: 15px;
    line-height: 17px;
  }
  .detail-summary p {
    max-width: 100%;
    overflow: hidden;
    margin: 3px 0 0;
    font-size: 12px;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail-summary .detail-play-all { margin-top: auto; }
  .empty-playlist {
    min-height: 300px;
    margin-bottom: calc(var(--player-height) + 16px);
  }
  .empty-playlist-copy {
    left: 14px;
    right: 14px;
    h2 {
      font-size: 20px;
    }
    p {
      line-height: 1.7;
    }
  }
}
@media (max-width: 700px) {
  .playlists-page :deep(.song-batch-toolbar > .el-button) {
    flex: 0 0 calc((100% - 8px) / 2);
    padding-inline: 6px;
  }
  .playlists-page :deep(.song-batch-toolbar > span) {
    order: 1;
    margin-inline-start: auto;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .playlists-page :deep(.batch-track-actions > .el-button) {
    padding-inline: 8px;
    font-size: 13px;
  }
}
</style>
