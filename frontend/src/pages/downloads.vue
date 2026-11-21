<script setup lang="ts">
import ListSkeleton from "../components/ListSkeleton.vue";
import RefreshButton from "../components/RefreshButton.vue";
import { confirmAction } from "../services/dialog";
import { appUrl } from "../services/urls";
import { nearScrollEnd, usePageScroll } from "../stores/usePageScroll";
import PageLayout from "../components/PageLayout.vue";
defineOptions({ name: "downloads" });
import {
  computed,
  nextTick,
  onMounted,
  onActivated,
  onDeactivated,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { ElMessage } from "element-plus";
import { requestApi as api } from "../services/api";
import { fileSize, qualityName } from "../services/music";
import type { Track } from "../../../backend/src/contracts";
import TrackCover from "../components/TrackCover.vue";
import TrackActions from "../components/TrackActions.vue";
import AppIcon from "../components/AppIcon.vue";
import { platformName } from "../services/music";
const props = withDefaults(
  defineProps<{
    currentId?: string;
    playing?: boolean;
    favoriteIds?: string[];
  }>(),
  { favoriteIds: () => [] },
);
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
interface Task {
  track?: Track;
  id: string;
  title: string;
  artist: string;
  quality: string;
  actualQuality?: string;
  format?: string;
  status: string;
  bytes: number;
  total: number;
  path?: string;
  error?: string;
  lyricPath?: string;
  coverPath?: string;
  embeddedLyrics?: boolean;
  embeddedCover?: boolean;
  warnings?: string[];
}
const tasks = ref<Task[]>([]),
  busy = ref(""),
  keyword = ref(""),
  filter = ref("all"),
  fetching = ref(false),
  initialLoading = ref(true);
const downloadFilters = [
  { value: "all", label: "全部" },
  { value: "queued", label: "等待中" },
  { value: "downloading", label: "正在下载" },
  { value: "processing", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
];
const status: Record<string, string> = {
  queued: "等待下载",
  resolving: "解析中",
  downloading: "下载中",
  tagging: "补全歌词与封面",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const activeStatuses = ["queued", "resolving", "downloading", "tagging"];
const waitingCount = computed(() => tasks.value.filter(task => task.status === "queued").length);
const downloadingCount = computed(() => tasks.value.filter(task => task.status === "downloading").length);
const isProcessing = (task: Task) => task.status === "resolving" || task.status === "tagging";
const processingCount = computed(() => tasks.value.filter(isProcessing).length);
const completedCount = computed(
  () => tasks.value.filter((t) => t.status === "completed").length,
);
const filtered = computed(() =>
  tasks.value.filter(
    (t) =>
      (filter.value === "all" ||
        (filter.value === "processing"
          ? isProcessing(t)
          : t.status === filter.value)) &&
      `${t.title} ${t.artist}`
        .toLowerCase()
        .includes(keyword.value.trim().toLowerCase()),
  ),
);
const batchBusy = ref(false);
const clearable = computed(() => tasks.value.filter(task => !activeStatuses.includes(task.status)).length);
async function clearRecords(){
  if(batchBusy.value || !clearable.value)return;
  batchBusy.value=true;
  try{
    if(!(await confirmAction("清空所有已完成、失败和已取消的下载记录？下载文件和进行中的任务会保留。","清空下载记录")))return;
    const result=await api("/downloads",{method:"DELETE"});
    ElMessage.success("已清空 "+result.removed+" 条下载记录");
    await load();
  }catch(error){ElMessage.error(error instanceof Error ? error.message : "清空下载记录失败");}
  finally{batchBusy.value=false;}
}
const retryable = computed(() => filtered.value.filter(task => task.status === "failed"));
const queued = computed(() => filtered.value.filter(task => task.status === "queued"));
function needsEnrichment(task: Task) {
  if(task.status !== "completed") return false;
  // Online track flags describe lookup capabilities, not files already on disk.
  const local = task.track && !task.track.online ? task.track : undefined;
  const hasLyrics = task.embeddedLyrics || task.lyricPath || local?.hasLyrics;
  const hasCover = task.embeddedCover || task.coverPath || local?.hasCover;
  return !hasLyrics || !hasCover;
}
const enrichable = computed(() => filtered.value.filter(needsEnrichment));
async function batchTasks(items: Task[], action: "retry" | "cancel" | "enrich"){
  if(batchBusy.value || !items.length)return;
  const ids=items.map(item=>item.id);
  batchBusy.value=true;
  let success=0, failed=0, warnings=0;
  try {
    if(action==="cancel" && !(await confirmAction("取消当前筛选范围内的 "+ids.length+" 个排队任务？","批量取消")))return;
    if(action==="cancel"){
      for(let offset=0;offset<ids.length;offset+=200){
        const result=await api("/downloads/cancel-queued",{method:"POST",body:JSON.stringify({ids:ids.slice(offset,offset+200)})});
        success+=result.cancelled;warnings+=result.skipped;
      }
      ElMessage.info("已取消 "+success+" 个任务，跳过 "+warnings+" 个已变更的任务");
      await load();
      return;
    }
    for(const id of ids){
      try{
        const result=await api("/downloads/"+encodeURIComponent(id)+"/"+action+(action==="enrich"?"?wait=1":""),{method:"POST"});
        success++;
        if(action==="enrich" && result.warnings?.length)warnings++;
      }catch{failed++;}
    }
    ElMessage({type:failed||warnings?"warning":"success",message:"已处理 "+success+" 个任务，失败 "+failed+" 个"+(warnings?"，"+warnings+" 个有歌词或封面提示":"")});
    await load();
  }catch(error){ElMessage.error(error instanceof Error ? error.message : "批量操作失败");}
  finally{batchBusy.value=false;}
}
const loadedCount = ref(16);
const visibleTasks = computed(() => filtered.value.slice(0, loadedCount.value));
const container = ref<HTMLElement>();
function scrollContainer() {
  return container.value?.querySelector<HTMLElement>(
    ".el-table__body-wrapper .el-scrollbar__wrap",
  );
}
function loadMore() {
  const element = scrollContainer();
  if (
    !element ||
    !element.clientHeight ||
    loadedCount.value >= filtered.value.length
  )
    return;
  if (nearScrollEnd(element)) {
    loadedCount.value += 16;
    void nextTick(loadMore);
  }
}
watch([keyword, filter], () => {
  loadedCount.value = 16;
  const element = scrollContainer();
  if (element) element.scrollTop = 0;
  void nextTick(loadMore);
});
watch(
  () => filtered.value.length,
  () => {
    void nextTick(loadMore);
  },
);
usePageScroll(() => container.value, loadMore);
const tableWidth = ref(0);
const showStatusColumns = computed(() => tableWidth.value >= 1020);
const compactColumns = computed(() => tableWidth.value < 620);
const showAudioDetails = computed(() => tableWidth.value >= 480);
let rowsObserver: ResizeObserver | undefined;
onMounted(() => {
  rowsObserver = new ResizeObserver(() => {
    if (container.value?.clientWidth) tableWidth.value = container.value.clientWidth;
    loadMore();
  });
  if (container.value) rowsObserver.observe(container.value);
  const element = scrollContainer();
  if (element) rowsObserver.observe(element);
  void nextTick(loadMore);
});
let timer: ReturnType<typeof setInterval>,
  loading = false,
  alive = true,
  lastError = "";
async function load(manual = false) {
  if (loading) return;
  loading = true;
  fetching.value = manual;
  try {
    const result = await api("/downloads");
    if (alive) {
      const previous = new Map(tasks.value.map((task) => [task.id, task]));
      const next = (result as Task[]).map((task) => {
        const existing = previous.get(task.id);
        return existing && JSON.stringify(existing) === JSON.stringify(task)
          ? existing
          : task;
      });
      if (
        next.length !== tasks.value.length ||
        next.some((task, index) => task !== tasks.value[index])
      )
        tasks.value = next;
      lastError = "";
    }
  } catch (e) {
    if (alive) {
      const text = (e as Error).message;
      if (manual || text !== lastError)
        ElMessage.error({ message: text, grouping: true });
      lastError = text;
    }
  } finally {
    loading = false;
    fetching.value = false;
    initialLoading.value = false;
  }
}
async function action(task: Task, name: string) {
  busy.value = task.id;
  try {
    await api(`/downloads/${task.id}/${name}`, { method: "POST" });
    ElMessage.success(
      name === "cancel"
        ? "下载任务已取消"
        : name === "retry"
          ? "已重新加入下载队列"
          : "已开始补全歌词与封面",
    );
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = "";
  }
}
function playTask(task: Task) {
  if (task.track)
    emit(
      "play",
      task.track,
      filtered.value.flatMap((item) => (item.track ? [item.track] : [])),
    );
}
function playTaskRow(task: Task, _column: unknown, event: MouseEvent) {
  if (!task.track?.available || event.detail > 1) return;
  if (event.target instanceof Element && event.target.closest("button, a, input, [role='button']")) return;
  playTask(task);
}
function trackAction(kind: string, task: Task) {
  if (!task.track) return;
  if (kind === "play") playTask(task);
  else if (kind === "favorite") emit("favorite", task.track);
  else emit("enqueue", task.track, kind === "next");
}
function extras(task: Task) {
  return [
    ...(activeStatuses.includes(task.status)
      ? [{ id: "cancel", name: "取消下载" }]
      : []),
    ...(["failed", "cancelled"].includes(task.status)
      ? [{ id: "retry", name: "重新下载" }]
      : []),
    ...(task.status === "completed"
      ? [
          ...(needsEnrichment(task) ? [{ id: "enrich", name: "补全标签" }] : []),
          ...(task.lyricPath ? [{ id: "lyrics", name: "保存歌词文件" }] : []),
        ]
      : []),
  ].map((item) => ({ ...item, disabled: busy.value === task.id }));
}
function extraAction(task: Task, name: string) {
  if (name === "lyrics") {
    const link = document.createElement("a");
    link.href = appUrl("/api/downloads/" + encodeURIComponent(task.id) + "/lyrics");
    link.download = "";
    link.click();
  } else void action(task, name);
}
function metadata(task: Task) {
  return [
    { label: "歌词内嵌", done: !!task.embeddedLyrics },
    { label: "封面内嵌", done: !!task.embeddedCover },
    { label: "LRC保存", done: !!task.lyricPath },
    { label: "封面保存", done: !!task.coverPath },
  ];
}
function percentage(task: Task) {
  return task.status === "completed"
    ? 100
    : task.total
      ? Math.min(100, Math.round((task.bytes / task.total) * 100))
      : 0;
}
function tagType(value: string) {
  return value === "completed"
    ? "success"
    : value === "failed"
      ? "danger"
      : value === "cancelled"
        ? "info"
        : "warning";
}
onActivated(() => {
  void nextTick(loadMore);
  void load();
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.hidden) void load();
  }, 1500);
});
onDeactivated(() => clearInterval(timer));
onUnmounted(() => {
  rowsObserver?.disconnect();
  alive = false;
  clearInterval(timer);
});
</script>
<template>
  <PageLayout
    floating
    title="下载管理"
    description="管理下载任务与 NAS 中的音乐文件"
  >
    <div ref="container" class="downloads-page" @scroll.capture="loadMore">
      <div class="download-summary">
        <span
          >共 {{ tasks.length }} 个任务 · {{ waitingCount }} 个等待中 ·
          {{ downloadingCount }} 个正在下载 · {{ processingCount }} 个处理中 ·
          {{ completedCount }} 个已完成</span
        >
      </div>
      <div class="download-toolbar music-segmented-scroll">
        <el-segmented
          v-model="filter"
          class="music-segmented"
          :options="downloadFilters"
          aria-label="下载状态"
        />
      </div>
      <div class="download-actions">
        <div class="download-batch-toolbar" aria-label="批量管理下载任务">
          <el-button :disabled="batchBusy || !clearable" @click="clearRecords">清空记录</el-button>
          <el-button :disabled="batchBusy || !retryable.length" @click="batchTasks(retryable, 'retry')">重试失败 ({{ retryable.length }})</el-button>
          <el-button :disabled="batchBusy || !queued.length" @click="batchTasks(queued, 'cancel')">取消排队 ({{ queued.length }})</el-button>
          <el-button :disabled="batchBusy || !enrichable.length" @click="batchTasks(enrichable, 'enrich')">补全歌词和封面 ({{ enrichable.length }})</el-button>
        </div>
        <div class="download-search">
          <el-input
            v-model="keyword"
            clearable
            placeholder="搜索歌曲、歌手"
            aria-label="搜索下载任务"
          />
          <RefreshButton :loading="fetching" @click="load(true)" />
        </div>
      </div>
      <el-table
        height="100%"
        :data="visibleTasks"
        row-key="id"
        class="download-table"
        :row-class-name="
          ({ row }: { row: Task }) =>
            [
              row.track?.available ? 'download-playable-row' : '',
              row.track && currentId === row.track.id ? 'download-current-row' : '',
            ].filter(Boolean).join(' ')
        "
        @row-click="playTaskRow"
      >
        <template #empty>
          <ListSkeleton v-if="initialLoading || fetching" class="download-skeleton" label="正在加载下载任务" />
          <span v-else>暂无匹配的下载任务</span>
        </template>
        <el-table-column label="#" :width="compactColumns ? 32 : 56" align="center">
          <template #default="{ $index }">
            <span class="track-number">{{ $index + 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="歌曲 / 音质" :min-width="compactColumns ? 140 : 320"
          ><template #default="{ row }"
            ><div
              class="track-info download-track-info"
              :title="row.path ? '保存位置：' + row.path : undefined"
            >
              <TrackCover
                v-if="row.track"
                :track="row.track"
                :playback="row.track.available"
                :playable="row.track.available"
                :playing="currentId === row.track.id && playing"
                @play="playTask(row)"
              />
              <div v-else class="cover">
                <AppIcon name="music" :size="23" />
              </div>
              <div class="track-copy">
                <div class="track-heading">
                  <span class="track-title" :title="row.title">{{ row.title }}</span
                  ><span class="quality-badge">{{
                    qualityName(row.actualQuality || row.quality)
                  }}</span>
                </div>
                <small class="download-artist-line"
                  ><span class="download-artist">{{ row.artist }}</span
                  ><span
                    v-if="row.track"
                    class="platform-badge download-mini-tag"
                    :data-platform="
                      row.track.online ? row.track.platform : 'local'
                    "
                    >{{
                      row.track.online
                        ? platformName(row.track.platform)
                        : "本地"
                    }}</span
                  ><span
                    v-if="
                      row.embeddedLyrics ||
                      row.lyricPath ||
                      row.track?.hasLyrics
                    "
                    class="lyric-badge download-mini-tag"
                    >词</span
                  ></small
                >
              </div>
            </div></template
          ></el-table-column
        >
        <el-table-column v-if="showStatusColumns" label="保存状态" width="180"
          ><template #default="{ row }"
            ><span class="download-metadata download-save-labels"
              ><span
                v-for="item in metadata(row)"
                :key="item.label"
                class="download-check-tag download-mini-tag"
                :class="{ checked: item.done }"
                :aria-label="item.label + (item.done ? '，已完成' : '，未完成')"
                ><AppIcon v-if="item.done" name="check" :size="12" />{{
                  item.label
                }}</span
              ></span
            ></template
          ></el-table-column
        >
        <el-table-column v-if="showStatusColumns" label="状态" width="160"
          ><template #default="{ row }"
            ><div class="download-status">
              <el-tag :type="tagType(row.status)" size="small">{{
                status[row.status] || row.status
              }}</el-tag
              ><template v-if="row.status === 'downloading'"
                ><el-progress
                  :percentage="percentage(row)"
                  :show-text="false"
                  :stroke-width="4"
                /><small class="download-size"
                  >{{ fileSize(row.bytes) }} / {{ fileSize(row.total) }}</small
                ></template
              ><span
                v-for="warning in row.warnings"
                :key="warning"
                class="download-inline-warning"
                >{{ warning }}</span
              ><span v-if="row.error" class="download-error-hint">{{
                row.error
              }}</span>
            </div></template
          ></el-table-column
        >
        <el-table-column v-if="showAudioDetails" label="格式 / 大小" :width="compactColumns ? 90 : 120"
          ><template #default="{ row }"
            ><div class="audio-spec">
              <strong>{{ row.format?.toUpperCase() || "待解析" }}</strong
              ><small>{{ fileSize(row.total || row.bytes) }}</small>
            </div></template
          ></el-table-column
        >
        <el-table-column v-if="showAudioDetails" label="时长" :width="compactColumns ? 52 : 65"
          ><template #default="{ row }"
            ><span class="track-time">{{
              row.track?.duration > 0
                ? Math.floor(row.track.duration / 60) +
                  ":" +
                  String(Math.floor(row.track.duration % 60)).padStart(2, "0")
                : "—"
            }}</span></template
          ></el-table-column
        >
        <el-table-column width="42" align="center"
          ><template #default="{ row }"
            ><el-button
              text
              class="icon-button favorite"
              :class="{
                liked: row.track && favoriteIds.includes(row.track.id),
              }"
              :disabled="!row.track"
              :aria-label="
                row.track && favoriteIds.includes(row.track.id)
                  ? '取消收藏'
                  : '收藏'
              "
              @click.stop="row.track && emit('favorite', row.track)"
              ><AppIcon
                name="heart"
                :size="17"
                :fill="
                  row.track && favoriteIds.includes(row.track.id)
                    ? 'currentColor'
                    : 'none'
                " /></el-button></template
        ></el-table-column>
        <el-table-column width="60" align="center" class-name="download-more-column"
          ><template #default="{ row }"
            ><TrackActions
              v-if="row.track"
              :track="row.track"
              :favorite="favoriteIds.includes(row.track.id)"
              :download-url="
                row.status === 'completed'
                  ? appUrl('/api/downloads/' + encodeURIComponent(row.id) + '/file')
                  : undefined
              "
              :extra-actions="extras(row)"
              @action="trackAction($event, row)"
              @extra="extraAction(row, $event)"
              @notify="emit('notify', $event)"
              @navigate="emit('navigate', $event)"
            /><el-dropdown
              v-else
              trigger="click"
              @command="extraAction(row, $event)"
              ><el-button
                text
                class="icon-button more-button"
                aria-label="更多操作"
                >···</el-button
              ><template #dropdown
                ><el-dropdown-menu
                  ><el-dropdown-item
                    v-for="item in extras(row)"
                    :key="item.id"
                    :command="item.id"
                    :disabled="item.disabled"
                    >{{ item.name }}</el-dropdown-item
                  ><el-dropdown-item v-if="!extras(row).length" disabled
                    >歌曲信息不可用</el-dropdown-item
                  ></el-dropdown-menu
                ></template
              ></el-dropdown
            ></template
          ></el-table-column
        >
      </el-table>
    </div>
  </PageLayout>
</template>

<style scoped lang="scss">
.download-table :deep(.el-table__empty-text:has(.download-skeleton)) {
  width: 100%;
}

.track-number {
  color: var(--day-muted, #6c8072);
  font-size: 13px;
  padding: 0;
  height: 35px;
  width: 25px;
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

.cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--day-selected, #2b4232);
  color: var(--day-muted, #6c997b);
  flex-shrink: 0;
  overflow: hidden;
  font-size: 24px;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  font-size: 12px;
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

@media (max-width: 700px) {
  .track-info {
    gap: 9px;
  }

  .track-info .cover {
    width: 36px;
    height: 36px;
  }

  .track-title {
    font-size: 13px;
  }

  .track-info small {
    font-size: 12px;
  }
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
  color: var(--day-muted, #66cf78);
  background: var(--day-selected, #1d3d25);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
}

.platform-badge {
  display: inline-block;
  margin-left: 7px;
  padding: 1px 5px;
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

.more-button {
  font-size: 22px;
  letter-spacing: 1px;
}

.platform-badge[data-platform="local"] {
  color: var(--day-muted, #83bb93);
  background: var(--day-selected, #213b29);
}

.download-metadata {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.download-metadata span {
  color: var(--day-muted, #8abb9a);
  background: var(--day-selected, #213a29);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
}

.downloads-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.downloads-page > :not(.download-table) {
  flex-shrink: 0;
}

.downloads-page > .download-table {
  flex: 1;
  min-height: 0;
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
.download-toolbar {
  margin-bottom: 22px;
}
.download-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 8px;
}
.download-search {
  display: flex;
  align-items: center;
  flex: 0 1 320px;
  min-width: min(180px, 100%);
  gap: 8px;
  margin-inline-start: auto;
}
.download-search :deep(.el-input__wrapper) {
  min-height: 32px;
}
.download-table {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: #151f18;
  --el-table-row-hover-bg-color: var(--song-row-highlight);
  border: 1px solid var(--day-line, #29382e);
  border-radius: 9px;
}
.download-size {
  color: var(--day-muted, #81988a);
  font-size: 13px;
}
.download-size {
  display: block;
  margin-top: 9px;
  font-variant-numeric: tabular-nums;
}
.download-error-hint {
  color: var(--day-danger-text, #da9b80);
  font-size: 12px;
  display: block;
  cursor: help;
}

.download-track-info .cover {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 5px;
  overflow: hidden;
}
.download-track-info .track-heading {
  min-width: 0;
}
.download-track-info .track-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.download-table :deep(.el-table__row:hover .cover-playback) {
  opacity: 1;
}

.download-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.download-status .el-progress {
  width: 100%;
}
.download-status .download-size {
  margin-top: 0;
}
.download-metadata .download-check-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--day-line, #354039);
  background: transparent;
  color: var(--day-muted, #758078);
  padding: 3px 7px;
  font-size: 13px;
  line-height: 18px;
}
.download-metadata .download-check-tag.checked {
  color: var(--day-accent-text, #84d6a0);
  border-color: var(--day-line, #345d40);
  background: var(--day-selected, #203b29);
}

.download-inline-warning {
  color: var(--day-muted, #c0a26d);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.download-status .download-error-hint {
  cursor: default;
  white-space: normal;
  overflow-wrap: anywhere;
}

.download-table {
  border: 0;
  border-radius: 0;
  --el-table-header-bg-color: transparent;
}
.download-table :deep(.el-table__cell) {
  padding: 0;
}
.download-table :deep(.el-table__header .cell) {
  font-size: 12px;
  font-weight: 400;
  padding-top: 6px;
  padding-bottom: 6px;
}
.download-table :deep(.el-table__body) {
  border-spacing: 0 var(--song-row-gap);
}
.download-table :deep(.el-table__body .el-table__cell) {
  height: var(--song-row-height);
  padding-block: 4px;
  border-bottom: 0;
}
.download-table .download-metadata .download-check-tag {
  gap: 2px;
  padding: 0 4px;
  font-size: 12px;
  line-height: 14px;
  border-radius: 3px;
}
.download-table .download-check-tag svg {
  width: 10px;
  height: 10px;
}
.download-track-info {
  min-height: 48px;
}
.download-table :deep(.download-playable-row) {
  cursor: pointer;
}
.download-table :deep(.el-table__body .el-table__row > .el-table__cell:first-child) {
  border-start-start-radius: var(--song-row-radius);
  border-end-start-radius: var(--song-row-radius);
}
.download-table :deep(.el-table__body .el-table__row > .el-table__cell:last-child) {
  border-start-end-radius: var(--song-row-radius);
  border-end-end-radius: var(--song-row-radius);
}
.download-table :deep(.download-more-column > .cell) {
  padding-inline: 6px 16px;
}
.download-table :deep(.download-current-row) {
  --el-table-tr-bg-color: var(--song-row-highlight);
}
.download-table :deep(.download-current-row > .el-table__cell:first-child) {
  box-shadow: inset 3px 0 #62e393;
}
.download-table :deep(.download-current-row .track-title) {
  color: var(--day-accent-text, #8bf1ae);
}
.download-table :deep(.el-table__row:hover :is(.track-number, .track-title)) {
  color: var(--song-row-hover-title);
}
.download-table :deep(.el-table__row:hover :is(.download-artist-line, .track-time, .audio-spec strong, .audio-spec small)) {
  color: var(--song-row-hover-text);
}

.download-track-info .download-artist-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.download-artist {
  margin-right: 3px;
}
.download-table .download-track-info .download-mini-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 16px;
  margin: 0;
  padding: 0 4px;
  border: 1px solid var(--day-line, #354039);
  border-radius: 3px;
  font-size: 12px;
  line-height: 14px;
  white-space: nowrap;
  color: var(--day-muted, #758078);
  background: transparent;
}
.download-table .download-track-info .platform-badge[data-platform="local"],
.download-table .download-track-info .lyric-badge,
.download-table .download-track-info .download-check-tag.checked {
  color: var(--day-accent-text, #84d6a0);
  border-color: var(--day-line, #345d40);
  background: var(--day-selected, #203b29);
}

.download-save-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
}
.download-table .download-save-labels .download-check-tag {
  height: 16px;
  font-size: 12px;
  line-height: 14px;
  padding: 0 4px;
}
.download-table .track-time {
  font-size: 13px;
  color: var(--day-muted, #8ba494);
  white-space: nowrap;
}
.download-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-shrink: 0;
  font-size: 14px;
  color: var(--day-muted, #8eaa98);
}
.track-title {
  font-size: 15px;
  line-height: 1.5;
  font-weight: 500;
}
.track-info small {
  font-size: 14px;
  line-height: 1.5;
  margin-top: 4px;
  color: var(--day-muted, #a2b3a8);
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
.download-table .download-track-info .download-mini-tag,
.download-table .download-save-labels .download-check-tag {
  height: auto;
  min-height: 20px;
  line-height: 18px;
}
.download-table :deep(.el-table__header .cell) {
  color: var(--day-muted, #a4b5aa);
  font-size: 13px;
}
.download-summary,
.download-toolbar,
.download-actions {
  margin-right: var(--list-right-inset);
}
.downloads-page > .download-table {
  width: calc(100% - var(--list-right-inset));
}
.download-table :deep(.el-scrollbar__bar) {
  --el-scrollbar-bg-color: var(--day-scrollbar, #34513e);
  --el-scrollbar-hover-bg-color: var(--day-scrollbar, #45664f);
  --el-scrollbar-opacity: 1;
  --el-scrollbar-hover-opacity: 1;
}
.download-table :deep(.el-scrollbar__view) {
  padding-bottom: var(--list-bottom-padding);
}
.download-batch-toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
.download-batch-toolbar > .el-button { margin: 0; }
@media (max-width: 700px) {
  .download-toolbar {
    margin-bottom: 12px;
  }
  .download-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .download-batch-toolbar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .download-batch-toolbar > .el-button {
    min-width: 0;
    padding-inline: 4px;
    font-size: 13px;
  }
  .download-search {
    flex: none;
    min-width: 0;
    margin: 0;
  }
}
</style>
