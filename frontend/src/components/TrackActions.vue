<script setup lang="ts">
import { isAndroidOnline } from "../services/platform";
import { appUrl } from "../services/urls";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { confirmAction } from "../services/dialog";
import type { Track } from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import { fileSize, platformName } from "../services/music";
import TrackCover from "./TrackCover.vue";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{
  track: Track;
  favorite: boolean;
  removable?: boolean;
  downloadUrl?: string;
  extraActions?: { id: string; name: string; disabled?: boolean }[];
}>();
const emit = defineEmits<{
  action: [action: "play" | "next" | "queue" | "favorite" | "remove"];
  notify: [message: string];
  navigate: [page: string];
  extra: [action: string];
}>();
const panel = ref(""),
  busy = ref(false),
  error = ref(""),
  details = ref(props.track);
const audioInfo = computed(() => {
  const item = details.value;
  const [, idPlatform, ...idParts] = item.id.split(":");
  const platform = item.platform || idPlatform;
  const songId = idParts.join(":");
  const extension = item.format?.toLowerCase();
  // Online locations identify a catalog track; they are not local disk paths.
  const onlineLocation =
    item.online && platform && songId
      ? `online/${platform}/${songId}${extension && extension !== "未知" ? "." + extension : ""}`
      : "";
  const variant =
    item.audioVariants?.find(
      (v) => v.format?.toLowerCase() === item.format?.toLowerCase(),
    ) || item.audioVariants?.[0];
  return [
    { label: "码率", value: variant?.bitrate ? variant.bitrate + " kbps" : "" },
    { label: "格式", value: item.format?.toUpperCase() },
    { label: "文件大小", value: item.size > 0 ? fileSize(item.size) : "" },
    {
      label: "时长",
      value:
        item.duration > 0
          ? Math.floor(item.duration / 60) +
            ":" +
            String(Math.floor(item.duration % 60)).padStart(2, "0")
          : "",
    },
    { label: "来源", value: item.platform ? platformName(item.platform) : "" },
    { label: "文件位置", value: item.fileLocation || onlineLocation },
  ].filter((row) => row.value);
});
const playlists = ref<{ id: string; name: string; count: number }[]>([]),
  playlistId = ref(""),
  newName = ref("");
const entries = computed(() => [
  { id: "play", name: "播放", icon: "play" },
  { id: "next", name: "下一首播放", icon: "plus" },
  { id: "queue", name: "加入队列", icon: "queue" },
  { id: "favorite", name: "收藏", icon: "heart" },
  { id: "playlist", name: "加入歌单", icon: "我的歌单" },
  { id: "details", name: "详情", icon: "music" },
  ...(!isAndroidOnline ? [{
    id: "download",
    name: props.downloadUrl
      ? "下载文件"
      : props.track.online
        ? "下载"
        : "下载文件",
    icon: "下载管理",
  }] : []),
  ...(!props.track.online
    ? [{ id: "deleteFile", name: "删除文件", icon: "trash" }]
    : []),
  ...(props.removable
    ? [{ id: "remove", name: "从歌单移除", icon: "close" }]
    : []),
]);
const menuEntries = computed(() => [
  ...entries.value,
  ...(props.extraActions || []).map((entry) => ({
    ...entry,
    icon:
      (
        {
          cancel: "close",
          retry: "refresh",
          enrich: "tags",
          lyrics: "lyrics",
        } as Record<string, string>
      )[entry.id] || "music",
  })),
]);
const panelOpen = computed({
  get: () => Boolean(panel.value),
  set: (value: boolean) => {
    if (!value) closePanel();
  },
});
function closePanel() {
  panel.value = "";
  error.value = "";
}
async function choose(action: string) {
  if (action === "deleteFile") {
    if (busy.value) return;
    if (
      !(await confirmAction(
        `永久删除「${props.track.title}」的原始歌曲文件及同名封面、歌词？此操作无法撤销，共用的封面和歌词会保留。`,
        "删除文件",
      ))
    )
      return;
    busy.value = true;
    window.dispatchEvent(
      new CustomEvent("track-file-deleting", { detail: props.track.id }),
    );
    try {
      const result = await api(
        "/tracks/" + encodeURIComponent(props.track.id) + "/file",
        { method: "DELETE" },
      );
      window.dispatchEvent(
        new CustomEvent("track-file-deleted", { detail: props.track.id }),
      );
      closePanel();
      if (result.warnings?.length)
        ElMessage.warning("歌曲已删除；" + result.warnings.join("；"));
      else emit("notify", "歌曲文件及专属封面、歌词已删除");
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      busy.value = false;
    }
    return;
  }
  if (props.extraActions?.some((entry) => entry.id === action)) {
    emit("extra", action);
    return;
  }
  if (action === "download" && props.downloadUrl) {
    const link = document.createElement("a");
    link.href = props.downloadUrl;
    link.download = "";
    link.click();
    return;
  }
  error.value = "";
  if (["play", "next", "queue", "favorite", "remove"].includes(action)) {
    emit("action", action as "play" | "next" | "queue" | "favorite" | "remove");
    return;
  }
  if (action === "download" && !props.track.online) {
    const link = document.createElement("a");
    link.href =
      appUrl("/api/tracks/" + encodeURIComponent(props.track.id) + "/download");
    link.download = "";
    link.click();
    return;
  }
  if (action === "download") {
    await download();
    return;
  }
  details.value = props.track;
  panel.value = action;
  busy.value = true;
  try {
    if (action === "details")
      details.value = await api(
        "/" +
          (props.track.online ? "online/" : "tracks/") +
          encodeURIComponent(props.track.id) +
          "/details",
      );
    if (action === "playlist") {
      playlists.value = await api("/playlists");
      playlistId.value = playlists.value[0]?.id || "";
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = false;
  }
}
async function createPlaylist() {
  if (!newName.value.trim()) return;
  busy.value = true;
  error.value = "";
  try {
    const item = await api("/playlists", {
      method: "POST",
      body: JSON.stringify({ name: newName.value.trim() }),
    });
    playlists.value.push({ ...item, count: 0 });
    playlistId.value = item.id;
    newName.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function addToPlaylist() {
  busy.value = true;
  error.value = "";
  try {
    await api(`/playlists/${playlistId.value}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId: props.track.id }),
    });
    closePanel();
    emit("notify", "已加入歌单");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function download() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api("/downloads", {
      method: "POST",
      body: JSON.stringify({ trackId: props.track.id }),
    });
    emit("notify", "已加入下载队列，可在“下载管理”查看进度");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "创建下载任务失败");
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <el-dropdown trigger="click" placement="bottom-end" @command="choose"
    ><el-button
      text
      class="icon-button more-button"
      aria-label="更多操作"
      @click.stop
      @dblclick.stop
      >···</el-button
    ><template #dropdown
      ><el-dropdown-menu
        ><el-dropdown-item
          v-for="entry in menuEntries"
          :key="entry.id"
          :command="entry.id"
          :disabled="'disabled' in entry && entry.disabled"
          ><AppIcon :name="entry.icon" :size="16" />{{
            entry.id === "favorite" && favorite ? "取消收藏" : entry.name
          }}</el-dropdown-item
        ></el-dropdown-menu
      ></template
    ></el-dropdown
  >
  <el-dialog
    v-if="panelOpen"
    v-model="panelOpen"
    class="music-dialog"
    :class="{ 'track-details-dialog': panel === 'details' }"
    :width="panel === 'details' ? '776px' : '620px'"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :title="panel === 'details' ? '歌曲信息' : '加入歌单'"
    ><el-form label-position="top" tag="div"
      ><div v-if="panel !== 'details'" class="modal-song">
        <TrackCover :track="track" />
        <div>
          <strong>{{ track.title }}</strong>
          <p>{{ track.artist }} · {{ platformName(track.platform) }}</p>
        </div>
      </div>
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        show-icon
        :closable="false"
      />
      <template v-if="panel === 'details'">
        <div v-loading="busy" class="track-details-layout">
          <aside class="track-details-summary">
            <div class="track-details-artwork">
              <TrackCover :track="details" />
            </div>
            <dl class="track-details-specs">
              <template v-for="row in audioInfo" :key="row.label"
                ><dt>{{ row.label }}：</dt>
                <dd>{{ row.value }}</dd></template
              >
            </dl>
          </aside>
          <section class="track-details-fields" aria-label="歌曲信息">
            <dl class="track-details-group">
              <div v-if="details.title" class="track-details-row">
                <dt>名称</dt>
                <dd>{{ details.title }}</dd>
              </div>
              <div v-if="details.album" class="track-details-row">
                <dt>专辑</dt>
                <dd>{{ details.album }}</dd>
              </div>
            </dl>
            <dl v-if="details.artist" class="track-details-group">
              <div class="track-details-row">
                <dt>歌手</dt>
                <dd>
                  <span class="track-details-artist"
                    ><AppIcon name="music" :size="16" />{{
                      details.artist
                    }}</span
                  >
                </dd>
              </div>
            </dl>
          </section>
        </div>
        <footer class="track-details-footer">
          <el-button class="secondary" @click="closePanel">关闭</el-button>
        </footer>
      </template>
      <template v-if="panel === 'playlist'"
        ><el-form-item class="modal-label" label="选择歌单"
          ><el-select v-model="playlistId"
            ><el-option value="" disabled label="请选择歌单" /><el-option
              v-for="item in playlists"
              :key="item.id"
              :value="item.id"
              :label="`${item.name}（${item.count} 首）`" /></el-select></el-form-item
        ><el-form class="modal-inline-form" @submit.prevent="createPlaylist"
          ><el-input
            v-model="newName"
            maxlength="80"
            placeholder="新建歌单名称"
            aria-label="新建歌单名称"
          /><el-button
            class="secondary"
            :disabled="busy || !newName.trim()"
            native-type="submit"
            >新建</el-button
          ></el-form
        >
        <footer>
          <el-button class="secondary" @click="closePanel">取消</el-button
          ><el-button
            class="primary"
            :disabled="busy || !playlistId"
            @click="addToPlaylist"
            type="primary"
            >{{ busy ? "处理中…" : "加入歌单" }}</el-button
          >
        </footer></template
      >
    </el-form></el-dialog
  >
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

.more-button {
  font-size: 22px;
  letter-spacing: 1px;
}

.modal-song {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 0;
  margin-bottom: 15px;
  border-bottom: 1px solid var(--border);
}

.modal-song :deep(.cover) {
  width: 60px;
  height: 60px;
}

.modal-song > div:last-child {
  min-width: 0;
}

.modal-song strong {
  font-size: 15px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.modal-song p {
  font-size: 13px;
  margin-top: 5px;
}


.modal-label {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 17px;
  font-size: 14px;
  color: var(--day-muted, #a1b9aa);
}

.modal-label select {
  border: 1px solid var(--day-line, #364c3e);
  border-radius: 7px;
  background: var(--day-surface-soft, #142018);
  color: var(--day-text, #d0e0d5);
  padding: 11px;
  max-width: 100%;
}

.modal-inline-form {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.modal-inline-form input {
  flex: 1;
  width: 0;
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
.modal-inline-form :deep(.el-input) {
  flex: 1;
  min-width: 0;
}
.modal-label :deep(.el-select) {
  display: block;
  width: 100%;
  margin-top: 9px;
}
:global(.music-dialog .el-form-item__label) {
  color: var(--el-text-color-regular);
}
:global(.music-dialog .el-form-item__content) {
  min-width: 0;
}
:global(.music-dialog.el-dialog) {
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 32px);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  overflow: hidden;
}
:global(.music-dialog .el-dialog__body) {
  max-height: calc(100dvh - 120px);
  overflow-y: auto;
}
:global(.music-dialog footer) {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
:global(.music-dialog.track-details-dialog) {
  padding: 16px 12px 20px;
  background: var(--day-surface, #101010);
  border-color: var(--day-line, #303030);
  border-radius: 18px;
  color: var(--day-text, #dedede);
}
:global(.track-details-dialog .el-dialog__header) {
  padding: 0 28px 25px 0;
}
:global(.track-details-dialog .el-dialog__title) {
  color: var(--day-text, #f2f2f2);
  font-size: 20px;
  font-weight: 700;
}
:global(.track-details-dialog .el-dialog__headerbtn) {
  top: 0;
  right: 0;
}
.track-details-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 20px;
  min-height: 460px;
}
.track-details-summary,
.track-details-fields {
  min-width: 0;
}
.track-details-artwork {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--day-line, #303030);
  border-radius: 12px;
}
.track-details-artwork :deep(.cover) {
  width: 152px;
  height: 152px;
  border-radius: 8px;
  overflow: hidden;
}
.track-details-specs {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 12px 0;
  padding: 20px 8px;
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
.track-details-specs dt {
  color: var(--day-muted, #8e8e8e);
  font-weight: 600;
}
.track-details-specs dd {
  margin: 0;
  color: var(--day-text, #bdbdbd);
  overflow-wrap: anywhere;
}
.track-details-group {
  border: 1px solid var(--day-line, #303030);
  border-radius: 12px;
  padding: 0 12px;
  margin: 0 0 12px;
}
.track-details-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 44px;
  padding: 8px 0;
  font-size: 14px;
}
.track-details-row + .track-details-row {
  border-top: 1px solid var(--day-line, #242424);
}
.track-details-row dt {
  flex-shrink: 0;
  color: var(--day-text, #bdbdbd);
}
.track-details-row dd {
  min-width: 0;
  margin: 0;
  text-align: right;
  color: var(--day-text, #eee);
  overflow-wrap: anywhere;
}
.track-details-artist {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 20px;
  background: var(--day-surface-soft, #252525);
  font-size: 14px;
  text-align: left;
}
.track-details-artist svg {
  flex-shrink: 0;
  color: var(--day-muted, #999);
}
:global(.music-dialog .track-details-footer) {
  margin-top: 24px;
}
.track-details-footer :deep(.el-button) {
  width: 153px;
  border: 0;
  border-radius: 22px;
  background: var(--day-surface-soft, #242424);
  color: var(--day-text, #dedede);
}
.track-details-footer :deep(.el-button:hover) {
  background: var(--day-surface-soft, #333);
  color: #fff;
}
@media (max-width: 650px) {
  .track-details-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    min-height: 0;
  }
  .track-details-artwork {
    height: 184px;
  }
  .track-details-specs {
    padding: 16px 8px;
  }
  :global(.track-details-dialog .el-dialog__body) {
    max-height: calc(100dvh - 140px);
  }
}
</style>
