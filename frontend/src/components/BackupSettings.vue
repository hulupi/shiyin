<script setup lang="ts">
import { ref } from "vue";
import { requestApi } from "../services/api";
import { confirmAction } from "../services/dialog";
import { notify, reportError } from "../services/feedback";

const maxBytes = 32 * 1024 * 1024;
const themeKey = "shiyin:theme";
const chartsKey = "shiyin:chart-preferences";
const fileInput = ref<HTMLInputElement>();
const busy = ref<"export" | "restore">();

function readBrowserPreferences(value: unknown) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("备份中的浏览器偏好格式有误");
  }
  const { theme, charts } = value as { theme?: unknown; charts?: unknown };
  if ((theme !== "dark" && theme !== "light") || !charts || typeof charts !== "object" || Array.isArray(charts)) {
    throw new Error("备份中的浏览器偏好格式有误");
  }
  for (const item of Object.values(charts)) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      Object.entries(item).some(([key, enabled]) =>
        !["visible", "recommended"].includes(key) || typeof enabled !== "boolean"
      )) throw new Error("备份中的榜单设置格式有误");
  }
  return { theme, charts };
}

async function exportBackup() {
  busy.value = "export";
  try {
    const backup = await requestApi("/backup");
    const browser = {
      theme: localStorage.getItem(themeKey) === "light" ? "light" : "dark",
      charts: JSON.parse(localStorage.getItem(chartsKey) ?? "{}"),
    };
    const blob = new Blob([JSON.stringify({ ...backup, browser })], { type: "application/json" });
    if (blob.size > maxBytes) throw new Error("备份超过 32 MB，无法导出");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "shiyin-backup-" + backup.createdAt.replace(/[:.]/g, "-") + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("备份已导出");
  } catch (error) {
    reportError(error);
  } finally {
    busy.value = undefined;
  }
}

async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || busy.value) return;
  busy.value = "restore";
  try {
    if (file.size > maxBytes) throw new Error("备份文件不能超过 32 MB");
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch { throw new Error("请选择拾音导出的 JSON 备份文件"); }
    if (backup?.format !== "shiyin-backup" || backup.version !== 1) {
      throw new Error("备份文件格式不正确或版本不受支持");
    }
    const browser = readBrowserPreferences(backup.browser);
    const sourceNotice = Array.isArray(backup.data?.sources)
      ? " 这份备份也会替换当前音源和脚本，并恢复备份时的启用状态。"
      : "";
    const confirmed = await confirmAction(
      "恢复会覆盖当前共享的收藏、播放记录、歌单、应用内日志、播放音质和下载偏好，以及此浏览器的主题和榜单设置。请只恢复你信任的备份。" + sourceNotice,
      "恢复拾音备份",
    );
    if (!confirmed) return;
    await requestApi("/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/vnd.shiyin.backup+json" },
      body: JSON.stringify(backup),
    });
    try {
      if (browser) {
        localStorage.setItem(themeKey, browser.theme);
        localStorage.setItem(chartsKey, JSON.stringify(browser.charts));
      }
      notify("备份已恢复，正在刷新页面");
    } catch {
      reportError("应用数据已恢复，浏览器偏好保存失败。");
    }
    setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    reportError(error);
  } finally {
    busy.value = undefined;
  }
}
</script>

<template>
  <section class="backup-panel" aria-labelledby="backup-title">
    <h2 id="backup-title">备份与恢复</h2>
    <p>导出收藏、播放记录、歌单、应用内日志、播放音质、下载偏好、音源脚本及其启用状态和排序，以及当前浏览器的主题与榜单设置。</p>
    <p>备份文件可能含有私人记录及音源脚本中的凭据，请妥善保存。换设备恢复后，请重新授权并扫描原路径的音乐目录，以找回收藏和歌单中的本地歌曲。</p>
    <div class="backup-actions">
      <el-button type="primary" :loading="busy === 'export'" :disabled="!!busy" @click="exportBackup">导出备份</el-button>
      <el-button :loading="busy === 'restore'" :disabled="!!busy" @click="fileInput?.click()">从备份恢复</el-button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="restoreBackup" />
    </div>
  </section>
</template>

<style scoped>
.backup-panel p {
  margin: 0.75rem 0;
  color: var(--day-muted);
  line-height: 1.6;
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
}

.backup-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
