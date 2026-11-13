<script setup lang="ts">
import ListSkeleton from "./ListSkeleton.vue";
import RefreshButton from "./RefreshButton.vue";
import { ref, watch } from "vue";
import {
  chartPlatforms,
  chartPreference,
  fetchCharts,
  setChartPreference,
  type Chart,
} from "../stores/chartPreferences";
import { reportError } from "../services/feedback";

const platform = ref(chartPlatforms[0].id);
const charts = ref<Chart[]>([]);
const loading = ref(false);
const error = ref("");
const retry = ref(0);
const preferenceSections = [
  { key: "visible", title: "榜单页显示", description: "选择要在榜单页显示的榜单。" },
  // { key: "recommended", title: "首页推荐", description: "选择要在首页推荐的榜单。" },
] as const;

watch([platform, retry], async ([id], _, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  loading.value = true;
  error.value = "";
  charts.value = [];
  try {
    const directory = await fetchCharts(id, { signal: controller.signal });
    if (!controller.signal.aborted) charts.value = directory;
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : "榜单加载失败";
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}, { immediate: true });

function update(ids: string[], option: "visible" | "recommended", enabled: boolean) {
  try {
    setChartPreference(platform.value, ids, option, enabled);
  } catch {
    reportError(new Error("无法保存榜单设置，请检查浏览器存储权限"));
  }
}
</script>

<template>
  <div class="chart-settings">
    <h2>榜单显示</h2>
    <div class="chart-settings-toolbar">
      <div class="chart-platforms music-segmented-scroll">
        <el-segmented
          v-model="platform"
          class="music-segmented"
          :options="chartPlatforms"
          :props="{ value: 'id', label: 'name' }"
          aria-label="榜单平台"
        />
      </div>
    </div>
    <ListSkeleton v-if="loading" class="chart-options" layout="cards" label="正在加载榜单设置" />
    <div v-else-if="error" class="chart-settings-state" role="alert">
      <span>{{ error }}</span>
      <RefreshButton label="重新加载" @click="retry++" />
    </div>
    <p v-else-if="!charts.length" class="chart-settings-state">该平台暂无榜单</p>
    <div v-else class="chart-preferences">
      <section v-for="section in preferenceSections" :key="section.key" class="chart-preference">
        <div class="chart-preference-heading">
          <div>
            <h3 :id="'chart-preference-' + section.key">{{ section.title }}</h3>
            <p>{{ section.description }}</p>
          </div>
          <div class="chart-settings-actions" aria-label="榜单页批量显示设置">
            <el-button size="small" @click="update(charts.map(chart => chart.id), 'visible', true)">全部显示</el-button>
            <el-button size="small" @click="update(charts.map(chart => chart.id), 'visible', false)">全部隐藏</el-button>
          </div>
        </div>
        <div class="chart-options" role="group" :aria-labelledby="'chart-preference-' + section.key">
          <button
            v-for="chart in charts"
            :key="chart.id"
            type="button"
            class="chart-option"
            :aria-pressed="chartPreference(platform, chart.id, section.key)"
            @click="update([chart.id], section.key, !chartPreference(platform, chart.id, section.key))"
          >
            {{ chart.name }}
            <span class="chart-option-check" aria-hidden="true">✓</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chart-settings-toolbar { margin: 14px 0 16px; }
.chart-platforms {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.chart-platforms::-webkit-scrollbar { display: none; }
.chart-platforms > .el-segmented { min-width: max-content; }
.chart-settings-state,
.chart-settings-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chart-settings-state { color: var(--muted); }
.chart-settings-actions > .el-button { margin: 0; }
.chart-preferences {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--day-surface-soft, #151c17);
}
.chart-preference {
  padding: 16px;
}
.chart-preference + .chart-preference {
  border-top: 1px solid var(--border);
}
.chart-preference-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 12px;
}
.chart-preference-heading h3 {
  margin: 0;
  font-size: 15px;
}
.chart-preference-heading p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.chart-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chart-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-height: 30px;
  padding: 3px 10px;
  border: 1px solid var(--day-line, #2a392e);
  border-radius: 999px;
  background: var(--day-surface-soft, #18201b);
  color: var(--day-muted, #a8b9ae);
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.chart-option[aria-pressed="true"] {
  border-color: var(--day-line, #315e42);
  background: var(--day-selected, #203d2d);
  color: var(--day-accent-text, #83e8a8);
}
.chart-option:hover { border-color: var(--green); }
.chart-option:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.chart-option-check {
  flex-shrink: 0;
  visibility: hidden;
}
.chart-option[aria-pressed="true"] .chart-option-check { visibility: visible; }
@media (max-width: 700px) {
  .chart-preference { padding: 12px; }
  .chart-option { min-height: 34px; }
}
</style>
