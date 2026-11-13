<script setup lang="ts">
import { isDesktop } from "../services/platform";
defineOptions({ inheritAttrs: false });
import { computed, onMounted, ref, watch } from "vue";
import { route } from "../services/router";
import PageLayout from "../components/PageLayout.vue";
import SourceManager from "../components/SourceManager.vue";
import SourceActivity from "../components/SourceActivity.vue";
import BackupSettings from "../components/BackupSettings.vue";
import ChartSettings from "../components/ChartSettings.vue";
import { theme } from "../stores/theme";
import appLogo from "../../../fpk/ICON_256.PNG?url";
import {
  library,
  preferredQuality,
  refreshLibrary,
  scanLibrary,
} from "../stores/library";
import { requestApi as api } from "../services/api";
import { reportError as message, inform } from "../services/feedback";
import { confirmAction } from "../services/dialog";
const appVersion = __APP_VERSION__;
const sections = [
  { id: "directories", label: "存储目录" },
  { id: "appearance", label: "外观" },
  { id: "sources", label: "音源管理" },
  { id: "quality", label: "播放音质" },
  { id: "downloads", label: "下载设置" },
  { id: "charts", label: "榜单设置" },
  { id: "logs", label: "日志" },
  { id: "backup", label: "备份与恢复" },
  { id: "about", label: "关于" },
] as const;
const detail = ref<HTMLElement>();
const activeSection = computed(() =>
  sections.find(section => section.id === route.value.query.section)?.id ?? sections[0].id,
);
watch(activeSection, () => {
  if (route.value.page !== "设置") return;
  detail.value?.scrollTo({ top: 0 });
}, { flush: "post" });

const savedDirectory = computed(() => library.value.directories[0]);
const directory = ref("");
const busy = ref(false);
watch(savedDirectory, (item, previous) => {
  if (item?.id !== previous?.id || item?.path !== previous?.path) {
    directory.value = item?.path ?? "";
  }
}, { immediate: true });
async function saveDirectory() {
  const path = directory.value.trim();
  if (busy.value || library.value.scan.running || path === savedDirectory.value?.path) return;
  if (!path) {
    inform("请输入音乐目录");
    return;
  }
  const current = savedDirectory.value;
  busy.value = true;
  try {
    const saved = await api(current ? "/directories/" + current.id : "/directories", {
      method: current ? "PUT" : "POST",
      body: JSON.stringify({ path }),
    });
    directory.value = saved.path;
    await refreshLibrary();
  } catch (e) {
    message(e);
  } finally {
    busy.value = false;
  }
}
async function removeDirectory(id: string) {
  if (!(await confirmAction("移除目录索引？不会删除原始音乐和歌词。"))) return;
  try {
    await api("/directories/" + id, { method: "DELETE" });
    await refreshLibrary();
  } catch (e) {
    message(e);
  }
}

async function saveQuality() {
  try {
    await api("/sources/settings", {
      method: "PATCH",
      body: JSON.stringify({ quality: preferredQuality.value }),
    });
  } catch (e) {
    message(e);
  }
}
type DownloadSettings = {
  directory: string;
  quality: string;
  filenameFormat: "artist-title" | "title-artist";
  saveLyrics: boolean;
  embedMetadata: boolean;
  autoDownloadFavorites: boolean;
};
const downloadSettings = ref<DownloadSettings>();
let savedDownloads: DownloadSettings | undefined;
let pendingDownloadSave = Promise.resolve();
const latestDownloadChanges = new Map<keyof DownloadSettings, symbol>();

onMounted(async () => {
  try {
    const saved: DownloadSettings = await api("/downloads/settings");
    savedDownloads = saved;
    downloadSettings.value = { ...saved };
  } catch (e) {
    message(e);
  }
});

function saveDownloadSetting<Key extends keyof DownloadSettings>(key: Key) {
  const draft = downloadSettings.value;
  if (!draft) return;
  const value = draft[key];
  const change = Symbol();
  latestDownloadChanges.set(key, change);
  pendingDownloadSave = pendingDownloadSave.then(async () => {
    if (!savedDownloads || value === savedDownloads[key]) return;
    try {
      const saved: DownloadSettings = await api("/downloads/settings", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      savedDownloads = saved;
      if (latestDownloadChanges.get(key) === change && draft[key] === value) draft[key] = saved[key];
    } catch (e) {
      if (latestDownloadChanges.get(key) === change && draft[key] === value) draft[key] = savedDownloads[key];
      message(e);
    }
  });
}
const musicDirectoryPlaceholder = isDesktop
  ? "输入本机音乐文件夹路径，例如 D:\\Music"
  : "输入 NAS 上的音乐文件夹路径，例如 /vol1/1000/music";

</script>
<template>
  <PageLayout
    title="间设置"
    description=""
    settings
  >
    <div class="settings-workspace">
      <aside class="settings-sidebar">
        <h1>设置</h1>
        <nav class="settings-nav" aria-label="设置分类">
          <a
            v-for="section in sections"
            :key="section.id"
            :href="'#/settings?section=' + section.id"
            :aria-current="activeSection === section.id ? 'page' : undefined"
          >{{ section.label }}</a>
        </nav>
      </aside>
      <div ref="detail" class="settings-detail" tabindex="0" role="region" aria-label="当前设置">
        <section v-show="activeSection === 'appearance'" class="settings-panel">
          <div class="section-heading">
            <h2>主题</h2>
          </div>
          <el-segmented
            v-model="theme"
            class="music-segmented"
            :options="[{ value: 'light', label: '白天模式' }, { value: 'dark', label: '黑夜模式' }]"
            aria-label="主题"
          />
        </section>
        <section v-show="activeSection === 'directories'" class="settings-panel">
          <div class="section-heading">
            <div>
              <h2>存储目录</h2>
              <p>自动扫描子目录中的歌曲与同名 LRC 歌词，原文件保持不变。</p>
            </div>
          </div>
          <el-form
            class="directory-form"
            label-position="top"
            :disabled="busy || library.scan.running"
            @submit.prevent="saveDirectory"
          >
            <el-form-item label="音乐库路径">
              <el-input
                v-model="directory"
                :placeholder="musicDirectoryPlaceholder"
                clearable
              />
            </el-form-item>
            <el-button
              :disabled="!directory.trim() || directory.trim() === savedDirectory?.path"
              :loading="busy"
              native-type="submit"
              type="primary"
            >保存并扫描</el-button>
          </el-form>
          <div
            v-for="item in library.directories"
            :key="item.id"
            class="directory-row"
          >
            <div>
              <strong>{{ item.path }}</strong
              ><small>已授权的本地音乐目录</small>
            </div>
            <el-button
              class="icon-button"
              :disabled="busy || library.scan.running"
              aria-label="移除目录"
              @click="removeDirectory(item.id)"
              text
              >×</el-button
            >
          </div>
          <div v-if="!library.directories.length" class="inline-empty">
            尚未添加目录，输入路径即可开始建立音乐库。
          </div>
          <div class="scan-status">
            <span
              >{{
                library.scan.running
                  ? "正在扫描"
                  : library.scan.finishedAt
                    ? "最近扫描已结束"
                    : "等待扫描"
              }}
              · 发现 {{ library.scan.scanned }} 首 · 失败
              {{ library.scan.failed }} 项</span
            ><el-button
              class="text-button"
              :disabled="busy"
              @click="scanLibrary(library.scan.running)"
              text
              >{{ library.scan.running ? "取消扫描" : "重新扫描" }}</el-button
            >
          </div>
          <p v-for="error in library.scan.errors" :key="error" class="error-text">
            {{ error }}
          </p>
        </section>
        <section v-show="activeSection === 'quality'" class="settings-panel quality-panel">
          <div class="section-heading">
            <div>
              <h2>在线播放音质</h2>
              <p>优先尝试所选音质，再按音源顺序降级。</p>
            </div>
          </div>
          <el-select
            v-model="preferredQuality"
            aria-label="默认在线音质"
            @change="saveQuality"
            ><el-option value="128k" label="128K" /><el-option
              value="320k"
              label="320K" /><el-option value="flac" label="FLAC" /><el-option
              value="flac24bit"
              label="Hi-Res"
          /></el-select>
        </section>
        <section v-show="activeSection === 'downloads'" class="settings-panel">
          <div class="section-heading">
            <div>
              <h2>下载设置</h2>
              <p>下载时优先尝试所选音质，失败后自动换源或降级。</p>
            </div>
          </div>
          <el-form
            v-if="downloadSettings"
            class="download-settings-form"
            label-position="top"
            @submit.prevent="saveDownloadSetting('directory')"
          >
            <el-form-item label="下载保存目录">
              <el-input
                v-model="downloadSettings.directory"
                placeholder="留空时使用音乐库目录"
                @change="saveDownloadSetting('directory')"
                clearable
              />
            </el-form-item>
            <el-form-item label="下载音质">
              <el-select v-model="downloadSettings.quality" @change="saveDownloadSetting('quality')">
                <el-option value="flac24bit" label="Hi-Res" />
                <el-option value="flac" label="FLAC" />
                <el-option value="320k" label="320K" />
                <el-option value="128k" label="128K" />
              </el-select>
            </el-form-item>
            <el-form-item label="下载文件命名">
              <el-select v-model="downloadSettings.filenameFormat" @change="saveDownloadSetting('filenameFormat')">
                <el-option value="artist-title" label="歌手 - 歌名" />
                <el-option value="title-artist" label="歌名 - 歌手" />
              </el-select>
            </el-form-item>
            <div class="download-options">
              <div class="setting-row">
                <div>
                  <strong>保存 LRC 歌词</strong>
                  <p>歌词未写入音频时，保存同名 LRC 文件。</p>
                </div>
                <el-switch v-model="downloadSettings.saveLyrics" @change="saveDownloadSetting('saveLyrics')" aria-label="未内嵌时保存 LRC 歌词" />
              </div>
              <div class="setting-row">
                <div>
                  <strong>内嵌歌词和封面</strong>
                  <p>将歌词和封面写入 MP3 或 FLAC 文件。</p>
                </div>
                <el-switch v-model="downloadSettings.embedMetadata" @change="saveDownloadSetting('embedMetadata')" aria-label="内嵌歌词和封面" />
              </div>
              <div class="setting-row">
                <div>
                  <strong>收藏时自动下载</strong>
                  <p>使用已保存的目录和音质，跳过本地已有的歌曲。</p>
                </div>
                <el-switch v-model="downloadSettings.autoDownloadFavorites" @change="saveDownloadSetting('autoDownloadFavorites')" aria-label="收藏时自动下载" />
              </div>
            </div>
          </el-form>
        </section>
        <section v-show="activeSection === 'charts'" class="settings-panel">
          <ChartSettings />
        </section>
        <section v-if="activeSection === 'about'" class="settings-panel about-panel" aria-labelledby="about-title">
          <header class="about-header">
            <img :src="appLogo" alt="" width="72" height="72">
            <div>
              <h2 id="about-title">拾音</h2>
              <p>飞牛 fnOS 音乐播放器</p>
            </div>
          </header>
          <section aria-labelledby="about-intro">
            <h3 id="about-intro">应用简介</h3>
            <p>拾音把飞牛 NAS 上分散的音乐目录整理成一个可搜索、可播放的音乐库。添加目录后，应用会扫描音频文件，读取歌曲标签、封面与同名 LRC 歌词。你可以在浏览器中听歌、整理歌单，并在找到同一首歌的本地版本时优先播放本地文件。</p>
            <p>除了本地音乐，拾音也支持搜索多个音乐平台。在线播放和下载通过你自行导入的第三方音源完成，可用曲目、音质和下载能力取决于音源及平台。</p>
          </section>
          <section aria-labelledby="about-version">
            <h3 id="about-version">版本信息</h3>
            <dl class="about-version">
              <dt>当前版本</dt><dd>v{{ appVersion }}</dd>
              <dt>应用 ID</dt><dd><code>shiyin</code></dd>
              <dt>运行平台</dt><dd>飞牛 fnOS 1.1.3100 或更高版本</dd>
              <dt>运行环境</dt><dd>Node.js 22.18 或更高版本</dd>
            </dl>
          </section>
          <section aria-labelledby="about-features">
            <h3 id="about-features">主要功能</h3>
            <ul>
              <li>扫描 NAS 音乐目录，读取歌曲标签、封面和 LRC 歌词。</li>
              <li>搜索多个音乐平台，通过自行导入的音源播放和下载。</li>
              <li>管理播放队列、收藏、歌单和播放历史，支持同步歌词。</li>
            </ul>
          </section>
          <section aria-labelledby="about-copyright">
            <h3 id="about-copyright">音乐版权与使用说明</h3>
            <p>音乐作品、录音、歌词、封面等内容的著作权及相关权利由各自权利人依法享有。拾音安装包不内置音乐曲库或第三方音源脚本。搜索结果、可播放状态及下载按钮均不代表权利人已授权相关使用。</p>
            <ul class="about-usage">
              <li><strong>本地音乐</strong>。请仅添加合法取得且有权使用的文件，并按授权范围播放、复制或备份。</li>
              <li><strong>第三方音源</strong>。请核实来源及使用许可，遵守平台条款。请勿利用音源绕过付费、账号权限、访问控制或版权保护措施。</li>
              <li><strong>下载和传播</strong>。请在权利人许可或法律允许的范围内下载及使用内容。未经许可或法律另有规定，请勿转载、分发、公开播放，或通过公网、共享链接等方式向公众提供音乐、歌词或封面。</li>
            </ul>
          </section>
        </section>
        <SourceManager v-show="activeSection === 'sources'" />
        <BackupSettings v-if="activeSection === 'backup'" />
        <section v-if="route.page === '设置' && activeSection === 'logs'" class="settings-panel">
          <div class="section-heading">
            <h2>播放、下载与异常日志</h2>
          </div>
          <SourceActivity />
        </section>
      </div>
    </div>
  </PageLayout>
</template>

<style scoped lang="scss">
.about-panel {
  display: grid;
  gap: 18px;
  max-width: 720px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.about-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.about-header img {
  flex-shrink: 0;
}

.about-panel :is(h2, p, ul) {
  margin: 0;
}

.about-panel h3 {
  margin: 0 0 6px;
}

.about-panel p + p {
  margin-top: 8px;
}

.about-version {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 18px;
  margin: 0;
}

.about-version dd {
  margin: 0;
}

.about-panel .about-usage {
  margin-top: 8px;
}

.about-usage li + li {
  margin-top: 6px;
}

.about-panel ul {
  padding-inline-start: 1.3em;
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

.settings-workspace {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(160px, 210px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 24px;
  min-width: 0;
  min-height: 0;
}
.settings-sidebar {
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
}
.settings-sidebar h1 {
  margin: 6px 0 4px;
  font-size: 22px;
}
.settings-sidebar p {
  margin: 0 0 20px;
  color: var(--muted);
  font-size: 13px;
}
.settings-nav {
  margin-top:12px;
  display: grid;
  gap: 4px;
}
.settings-nav > a {
  display: block;
  padding: 10px 13px;
  border-inline-start: 2px solid transparent;
  border-radius: 7px;
  color: var(--day-muted, #a8b9ae);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.settings-nav > a:hover {
  background: var(--day-surface-soft, #203128);
  color: var(--day-text, #e2eae5);
}
.settings-nav > a[aria-current="page"] {
  border-inline-start-color: var(--green);
  background: var(--day-selected, #203d2d);
  color: var(--day-accent-text, #83e8a8);
}
.settings-nav > a:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}
.settings-detail {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
  padding: 24px 28px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--day-surface-soft, #151c17);
}
.settings-detail > :deep(.source-manager) {
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
}
.settings-detail > :deep(.source-manager > .section-heading),
.settings-panel > .section-heading {
  margin-bottom: 16px;
}
.settings-detail :deep(h2) {
  margin: 0;
  font-size: 18px;
}
.section-heading {
  display: flex;
  gap: 14px;
  align-items: center;
  color: var(--day-muted, #8fbd9e);
  margin-bottom: 12px;
}

.section-heading h2 {
  color: var(--day-text, #e2eae5);
  font-size: 16px;
}

.section-heading p {
  font-size: 13px;
  margin-top: 5px;
}

.directory-form {
  margin-bottom: 12px;
}

.directory-form :deep(.el-form-item) {
  margin-bottom: 8px;
}

.directory-form :deep(.el-form-item__label) {
  margin-bottom: 4px;
}

.directory-row {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 8px 0;
  color: var(--day-muted, #7aab88);
}

.directory-row + .directory-row {
  border-top: 1px solid var(--border);
}

.directory-row > span {
  font-size: 25px;
}

.directory-row div {
  flex: 1;
  min-width: 0;
}

.directory-row strong {
  display: block;
  color: var(--day-text, #c4d4ca);
  font-weight: 400;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.directory-row small {
  display: block;
  color: var(--day-muted, #66796d);
  font-size: 12px;
  margin-top: 5px;
}

.scan-status {
  border-top: 1px solid var(--border);
  padding-top: 7px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--day-muted, #7f9287);
  font-size: 13px;
  gap: 15px;
}

.text-button {
  color: var(--green);
  font-size: 13px;
}

.inline-empty {
  font-size: 14px;
  color: var(--day-muted, #697f71);
  padding: 6px 0 10px;
}

.error-text {
  color: var(--day-danger-text, #e5a68c);
  font-size: 14px;
  overflow-wrap: anywhere;
}

@media (max-width: 700px) {
  .settings-workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
  }
  .settings-sidebar {
    overflow: visible;
  }
  .settings-sidebar h1 {
    margin-top: 0;
    font-size: 20px;
  }
  .settings-sidebar p {
    margin-bottom: 10px;
  }
  .settings-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }
  .settings-nav > a {
    display: grid;
    place-items: center start;
    text-align: start;
    padding: 8px 10px;
    font-size: 12px;
  }
  .settings-detail {
    min-height: 0;
    padding: 15px;
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

  .scan-status {
    font-size: 12px;
    align-items: flex-start;
  }
}

.settings-panel select {
  background: var(--day-surface-soft, #1b2a20);
  color: var(--day-text, #b6cebf);
  border: 1px solid var(--day-line, #3b5142);
  border-radius: 6px;
  padding: 9px 15px;
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
.settings-panel > :deep(.el-select) {
  width: min(100%, 300px);
}
.quality-panel > :deep(.el-select) { width: 116px; flex: 0 0 auto; }
.download-settings-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(112px, 160px); gap: 8px 12px; }
.download-settings-form :deep(.el-form-item) { margin-bottom: 0; }
.download-settings-form :deep(.el-form-item__label) { margin-bottom: 4px; }
.download-options { grid-column: 1 / -1; }
.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-block: 12px;
  border-top: 1px solid var(--border);
}
.setting-row strong { font-weight: 500; }
.setting-row p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.setting-row :deep(.el-switch) { flex-shrink: 0; }
@media (max-width: 460px) {
  .download-settings-form { grid-template-columns: minmax(0, 1fr); }

}
</style>
