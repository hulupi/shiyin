<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { confirmAction } from "../services/dialog";
import { onMounted, ref, watch } from "vue";
import type { UploadFile, UploadInstance } from "element-plus";
import { requestApi as api } from "../services/api";
interface Source {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  priority: number;
  capabilities: Record<string, { actions: string[]; qualitys: string[] }>;
}
const sources = ref<Source[]>([]),
  busy = ref(""),
  error = ref(""),
  success = ref("");
const uploader = ref<UploadInstance>();
const names: Record<string, string> = {
  wy: "网易云",
  tx: "QQ",
  kw: "酷我",
  kg: "酷狗",
  mg: "咪咕",
  local: "扩展元信息",
};
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
watch(
  success,
  (text) => {
    if (text) {
      ElMessage.success({ message: text, grouping: true });
      success.value = "";
    }
  },
  { flush: "sync" },
);
async function load() {
  sources.value = await api("/sources");
}
async function operation(
  id: string,
  action: () => Promise<unknown>,
  message = "",
) {
  busy.value = id;
  error.value = "";
  success.value = "";
  try {
    await action();
    await load();
    success.value = message;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败";
  } finally {
    busy.value = "";
  }
}
async function importFile(upload: UploadFile) {
  const file = upload.raw;
  uploader.value?.clearFiles();
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".js") || file.size > 1024 * 1024) {
    error.value = "请选择不超过 1 MB 的 .js 音源脚本";
    return;
  }
  await operation(
    "import",
    async () =>
      api("/sources/import", {
        method: "POST",
        body: JSON.stringify({ script: await file.text() }),
      }),
    "音源已导入并完成初始化",
  );
  uploader.value?.clearFiles();
}
async function importOnline() {
  if (busy.value) return;
  let url: string;
  try {
    const result = await ElMessageBox.prompt("粘贴 .js 音源直链，例如 GitHub Raw 链接。", "在线导入音源", {
      inputPlaceholder: "https://…",
      inputValidator: (value) => /^https?:\/\/\S+$/i.test(value?.trim() ?? "") || "请输入有效的 HTTP 或 HTTPS 链接",
      confirmButtonText: "导入",
      cancelButtonText: "取消",
      closeOnClickModal: false,
    });
    url = result.value.trim();
  } catch {
    return;
  }
  if (busy.value) return;
  await operation(
    "online-import",
    () => api("/sources/import", { method: "POST", body: JSON.stringify({ url }) }),
    "音源已导入并完成初始化",
  );
}
async function remove(source: Source) {
  if (await confirmAction(`删除音源「${source.name}」？`))
    await operation(source.id, () =>
      api("/sources/" + source.id, { method: "DELETE" }),
    );
}
onMounted(() => load().catch((e) => (error.value = e.message)));
</script>
<template>
  <section class="settings-panel source-manager">
    <div class="section-heading">
      <div>
        <div class="source-heading">
          <h2>多音源管理</h2>
          <div class="source-links">
            <a href="https://github.com/shellsec/lx-music-source" target="_blank" rel="noopener noreferrer">音源1</a>
            <a href="https://github.com/guoyue2010/lxmusic-" target="_blank" rel="noopener noreferrer">音源2</a>
          </div>
        </div>
        <p>
          本地文件优先；同平台、同音质按下列顺序取链，失败后自动尝试下一音源。
        </p>
      </div>
      <div class="source-upload">
        <el-button class="source-import" :disabled="!!busy" :loading="busy === 'online-import'" @click="importOnline">在线导入</el-button>
        <el-upload
          ref="uploader"
          class="source-file-upload"
          accept=".js"
          :auto-upload="false"
          :show-file-list="false"
          :disabled="!!busy"
          :on-change="importFile"
          ><el-button
            class="source-import"
            :disabled="!!busy"
            type="primary"
            :loading="busy === 'import'"
            >导入音源</el-button>
        </el-upload>
      </div>
    </div>

    <div v-if="!sources.length" class="inline-empty">
      导入你使用的洛雪 .js 音源文件。可同时启用多个脚本，支持的平台与音质以实际声明为准。
    </div>
    <div
      v-for="(source, index) in sources"
      :key="source.id"
      class="source-card"
      :class="{ disabled: !source.enabled }"
    >
      <div class="source-index">{{ String(index + 1).padStart(2, "0") }}</div>
      <div class="source-details">
        <div class="source-title">
          <strong :title="source.name">{{ source.name }}</strong>
          <small v-if="source.version" class="source-version" :title="source.version">{{ source.version }}</small>
          <span :class="source.enabled ? 'enabled-badge' : 'disabled-badge'">{{
            source.enabled ? "已启用" : "已停用"
          }}</span>
        </div>
        <p v-if="source.author || source.description" class="source-preview">
          {{ [source.author, source.description].filter(Boolean).join(" · ") }}
        </p>
        <div class="source-capabilities">
          <span v-for="(capability, platform) in source.capabilities" :key="platform">
            {{ names[platform] || platform }}
            <small>{{ capability.qualitys.join(" / ") || capability.actions.join(" / ") }}</small>
          </span>
        </div>
      </div>
      <div class="source-actions">
        <el-button
          :disabled="!!busy || index === 0"
          title="上移"
          aria-label="上移"
          @click="
            operation(source.id, () =>
              api('/sources/' + source.id, {
                method: 'PATCH',
                body: JSON.stringify({ move: 'up' }),
              }),
            )
          "
        >↑</el-button>
        <el-button
          :disabled="!!busy || index === sources.length - 1"
          title="下移"
          aria-label="下移"
          @click="
            operation(source.id, () =>
              api('/sources/' + source.id, {
                method: 'PATCH',
                body: JSON.stringify({ move: 'down' }),
              }),
            )
          "
        >↓</el-button>
        <el-button
          :disabled="!!busy"
          @click="
            operation(source.id, () =>
              api('/sources/' + source.id, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: !source.enabled }),
              }),
            )
          "
        >{{ source.enabled ? "停用" : "启用" }}</el-button>
        <el-button
          :disabled="!!busy"
          @click="
            operation(
              source.id,
              () => api('/sources/' + source.id + '/check', { method: 'POST' }),
              '初始化检查通过，实际取链结果以播放为准',
            )
          "
        >{{ busy === source.id ? "处理中…" : "检查初始化" }}</el-button>
        <el-button :disabled="!!busy" @click="remove(source)">删除</el-button>
      </div>
    </div>
    <div class="source-help">
      优先遍历目标音质，全部失败后再降级。支持 lx 事件、请求、常用
      Buffer/加密和压缩 API；依赖完整浏览器 DOM、Node 模块或私有 API
      的脚本暂不兼容。
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-panel {
  border: 1px solid var(--border);
  background: var(--day-surface-soft, #151c17);
  padding: 16px 18px;
  border-radius: 10px;
  margin-bottom: 12px;
}

.section-heading {
  display: flex;
  gap: 14px;
  align-items: center;
  color: var(--day-muted, #8fbd9e);
  margin-bottom: 12px;
}

.section-heading > span {
  font-size: 30px;
}

.section-heading h2 {
  color: var(--day-text, #e2eae5);
  font-size: 16px;
}

.section-heading p {
  font-size: 13px;
  margin-top: 5px;
}

.inline-empty {
  font-size: 14px;
  color: var(--day-muted, #697f71);
  padding: 10px 0;
}

@media (max-width: 700px) {
  .settings-panel {
    padding: 12px;
  }

  .section-heading {
    gap: 10px;
  }

  .section-heading h2 {
    font-size: 14px;
  }

  .section-heading p {
    font-size: 12px;
  }
}
.source-manager .section-heading {
  flex-wrap: wrap;
}

.source-import.el-button {
  width: 88px;
  height: 32px;
  padding-inline: 4px;
}

.source-card {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  grid-template-areas: "index details actions";
  align-items: start;
  gap: 10px;
  padding: 12px 0;
}

.source-card + .source-card {
  border-top: 1px solid var(--border);
}

.source-card.disabled .source-details {
  opacity: 0.55;
}

.source-index {
  grid-area: index;
  color: var(--day-muted, #527b60);
  font-size: 14px;
  padding-top: 4px;
}

.source-details {
  min-width: 0;
  grid-area: details;
}

.source-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
}

.source-title strong {
  font-size: 14px;
  font-weight: 500;
}

.source-title small {
  color: var(--day-muted, #718578);
  font-size: 12px;
}

.enabled-badge,
.disabled-badge {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--day-selected, #203f2b);
  color: var(--day-muted, #66c786);
}

.disabled-badge {
  background: var(--day-surface-soft, #29312b);
  color: var(--day-muted, #819386);
}

.source-title strong,
.source-version,
.source-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-version {
  flex: 0 1 auto;
  max-width: 40ch;
}
.enabled-badge,
.disabled-badge { flex-shrink: 0; }
.source-preview {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.source-capabilities {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.source-capabilities > span {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  background: var(--day-surface-soft, #1c2a20);
  border: 1px solid var(--day-line, #2d4033);
  border-radius: 5px;
  padding: 5px 7px;
  font-size: 12px;
  color: var(--day-muted, #a1baaa);
}

.source-capabilities small {
  font-size: 12px;
  color: var(--day-muted, #678773);
  margin-left: 4px;
}

.source-actions {
  grid-area: actions;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  max-width: 245px;
}

.source-actions button {
  padding: 6px 8px;
  border: 1px solid var(--day-line, #2d3d32);
  border-radius: 4px;
  font-size: 12px;
  color: var(--day-muted, #91ad9b);
}

.source-help {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  font-size: 12px;
  color: var(--day-muted, #6e8476);
  line-height: 1.9;
}

.settings-panel select {
  background: var(--day-surface-soft, #1b2a20);
  color: var(--day-text, #b6cebf);
  border: 1px solid var(--day-line, #3b5142);
  border-radius: 6px;
  padding: 9px 15px;
}

.settings-panel > :deep(.el-select) {
  width: min(100%, 300px);
}
.source-upload {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.section-heading > .source-upload {
  flex: none;
}
@media (max-width: 700px) {
  .source-manager .section-heading {
    flex-wrap: wrap;
  }
  .source-upload {
    margin-left: 0;
  }
}
.source-manager { container-type: inline-size; }
@container (max-width: 600px) {
  .source-card {
    grid-template-columns: 20px minmax(0, 1fr);
    grid-template-areas: "index details" ". actions";
    row-gap: 8px;
  }
  .source-title { gap: 6px; }
  .source-version { max-width: 7ch; }
  .source-capabilities {
    gap: 4px;
    margin-top: 8px;
  }
  .source-capabilities > span { padding: 3px 5px; }
  .source-actions { max-width: none; }
  .source-actions > .el-button {
    margin: 0;
    min-height: 32px;
    padding-inline: 6px;
  }
  .source-manager .section-heading > div:not(.source-upload) {
    flex: 1;
    min-width: 0;
  }
  .section-heading > .source-upload {
    flex-basis: 100%;
    margin-left: 0;
  }
}
.source-heading,
.source-links {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.source-links a {
  color: var(--green);
  font-size: 12px;
  white-space: nowrap;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
