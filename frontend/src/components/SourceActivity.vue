<script setup lang="ts">
import ListSkeleton from "./ListSkeleton.vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { requestApi } from "../services/api";
import { confirmAction } from "../services/dialog";
import { qualityName } from "../services/music";

const operationLabels = { playback: "播放", download: "下载", exception: "异常" };
type Operation = keyof typeof operationLabels;
const stageNames = {
  plan: "音源顺序",
  request: "发送请求",
  response: "收到响应",
  "audio-url": "音频地址",
  download: "开始下载",
  skipped: "跳过音源",
  attempt: "尝试音源",
  switch: "切换音源或音质",
  resolved: "已取得音频",
  "source-failed": "音源失败",
  playing: "开始播放",
  completed: "下载完成",
  failed: "失败",
  cancelled: "已取消",
};
const reasons = {
  timeout: "请求超时",
  unavailable: "取链或音频校验失败",
  playback: "播放器无法读取音频",
  transfer: "下载或文件校验失败",
};
interface Activity {
  id: string;
  operationId: string;
  operation: Operation;
  stage: keyof typeof stageNames;
  reason?: keyof typeof reasons;
  time: string;
  title: string;
  artist: string;
  requestedQuality: string;
  requestUrl?: string;
  audioUrl?: string;
  downloadUrl?: string;
  method?: string;
  statusCode?: number;
  sourcePosition?: number;
  message?: string;
  source?: string;
  quality?: string;
  format?: string;
  bitrate?: number;
  fromSource?: string;
  fromQuality?: string;
}
const loading = ref(false);
const clearing = ref(false);
const error = ref("");
const filter = ref<Operation | "all">("all");
const entries = ref<Activity[]>([]);
const groups = computed(() => {
  const operations = new Map<string, { latest: Activity; events: Activity[] }>();
  for (const event of entries.value) {
    // Older logs may still contain separate HTTP response events.
    if (event.stage === "response") continue;
    if (filter.value === "exception") {
      if (event.stage !== "failed" && event.stage !== "source-failed") continue;
    } else if (filter.value !== "all" && event.operation !== filter.value) continue;
    const group = operations.get(event.operationId);
    if (group) group.events.push(event);
    else operations.set(event.operationId, { latest: event, events: [event] });
  }
  return [...operations.entries()].map(([id, group]) => ({
    id,
    latest: group.latest,
    events: group.events.reverse(),
  }));
});
const filters = [
  { value: "all", label: "全部" },
  { value: "playback", label: "播放" },
  { value: "download", label: "下载" },
  { value: "exception", label: "异常" },
];
const dates = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" });

let inFlight = false;
let revision = 0;
async function load(background = false) {
  if (inFlight || clearing.value) return;
  const requestedRevision = revision;
  inFlight = true;
  if (!background) {
    loading.value = true;
    error.value = "";
  }
  try {
    const result = await requestApi("/sources/activity");
    if (requestedRevision !== revision) return;
    entries.value = result;
    error.value = "";
  } catch (e) {
    if (!background && requestedRevision === revision) error.value = e instanceof Error ? e.message : "日志读取失败";
  } finally {
    inFlight = false;
    loading.value = false;
  }
}
async function clearLogs() {
  if (clearing.value || !entries.value.length) return;
  if (!(await confirmAction("确定清空全部日志？", "清空日志"))) return;
  clearing.value = true;
  revision++;
  error.value = "";
  try {
    await requestApi("/sources/activity", { method: "DELETE" });
    entries.value = [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "清空日志失败";
  } finally {
    clearing.value = false;
  }
}
let refreshTimer: number | undefined;
onMounted(() => {
  void load();
  refreshTimer = window.setInterval(() => void load(true), 3000);
});
onUnmounted(() => window.clearInterval(refreshTimer));

function resultLabel(event: Activity) {
  if (event.stage === "playing") return "播放音源";
  if (event.stage === "completed") return "下载音源";
  if (event.stage === "failed" || event.stage === "cancelled") return stageNames[event.stage];
  if (event.stage === "resolved")
    return event.operation === "playback" ? "已取链，等待播放确认" : "已取链，等待下载完成";
  if (event.stage === "source-failed") return "当前音源失败";
  return "正在尝试";
}
function sourceLabel(source?: string, quality?: string) {
  return [source, quality ? qualityName(quality) : ""].filter(Boolean).join(" · ");
}
function urls(event: Activity) {
  return [
    { label: "请求地址", value: event.requestUrl },
    { label: "音频地址", value: event.audioUrl },
    { label: "下载地址", value: event.downloadUrl },
  ].filter((item): item is { label: string; value: string } => !!item.value);
}
function httpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
</script>

<template>
  <div class="activity-toolbar">
    <el-segmented v-model="filter" class="music-segmented" :options="filters" aria-label="日志类型" />
    <div class="activity-actions">
      <el-button :loading="loading" :disabled="clearing" @click="load()">刷新</el-button>
      <el-button type="danger" plain :loading="clearing" :disabled="!entries.length" @click="clearLogs">清空日志</el-button>
    </div>
  </div>
  <p v-if="error" role="alert">{{ error }}</p>
  <ListSkeleton v-else-if="loading && !groups.length" label="正在加载日志" />
  <p v-else-if="!groups.length">暂无日志</p>
  <ul v-else class="activity-list" :aria-busy="loading">
    <li v-for="{ id, latest, events } in groups" :key="id">
      <div class="activity-title">
        <strong>{{ latest.title }}</strong>
        <span>{{ operationLabels[latest.operation] }} · {{ dates.format(new Date(latest.time)) }}</span>
      </div>
      <p v-if="latest.artist">{{ latest.artist }}</p>
      <p v-if="latest.message">{{ latest.message }}</p>
      <p v-else-if="latest.reason && events.length === 1">{{ reasons[latest.reason] }}</p>
      <div class="activity-result" :class="{ confirmed: latest.stage === 'playing' || latest.stage === 'completed' }">
        <span>{{ resultLabel(latest) }}</span>
        <strong v-if="latest.source">{{ sourceLabel(latest.source, latest.quality) }}</strong>
        <span v-if="latest.format && latest.format !== latest.quality">{{ latest.format }}</span>
        <span v-if="latest.bitrate">{{ latest.bitrate }} kbps</span>
      </div>
      <details v-if="events.length > 1 || urls(latest).length" class="activity-details">
        <summary>查看音源过程（{{ events.length }} 条）</summary>
        <p>请求音质 {{ qualityName(latest.requestedQuality) }}</p>
        <ol>
          <li v-for="entry in events" :key="entry.id">
            <strong>{{ stageNames[entry.stage] }}</strong>
            <span v-if="entry.sourcePosition" class="source-position"> · 设置第 {{ entry.sourcePosition }} 位</span>
            <template v-if="entry.fromSource"> · {{ sourceLabel(entry.fromSource, entry.fromQuality) }} →</template>
            <template v-else-if="entry.source || entry.quality"> ·</template>
            {{ sourceLabel(entry.source, entry.quality) }}
            <template v-if="entry.reason"> · {{ reasons[entry.reason] }}</template>
            <template v-if="entry.method"> · {{ entry.method }}</template>
            <template v-if="entry.statusCode !== undefined"> · HTTP {{ entry.statusCode }}</template>
            <p v-if="entry.message" class="event-message">{{ entry.message }}</p>
            <div v-for="url in urls(entry)" :key="url.label" class="event-url">
              <span>{{ url.label }}：</span>
              <a v-if="httpUrl(url.value)" :href="httpUrl(url.value)" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{{ url.value }}</a>
              <code v-else>{{ url.value }}</code>
            </div>
          </li>
        </ol>
      </details>
    </li>
  </ul>
</template>

<style scoped>
.event-url { overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; margin-block: 4px; user-select: text; }
.event-url a { color: var(--green); text-decoration: underline; }
.source-position { color: var(--muted); font-size: 12px; }
.activity-details .event-message { white-space: pre-wrap; overflow-wrap: anywhere; }

.activity-toolbar {
  flex-wrap: wrap;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.activity-actions {
  display: flex;
  gap: 8px;
}
.activity-actions > .el-button { margin: 0; }
.activity-list {
  padding: 0;
  margin: 12px 0 0;
  list-style: none;
}
.activity-list > li {
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.activity-title {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
}
.activity-list p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.activity-title > span {
  color: var(--muted);
  font-size: 12px;
}
.activity-result {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin-top: 8px;
}
.activity-result.confirmed {
  color: var(--green);
}
.activity-details {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
.activity-details > summary { cursor: pointer; }
.activity-details > ol {
  margin: 6px 0 0;
  padding-inline-start: 24px;
}
.activity-details li { padding-block: 3px; }
</style>
