<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import RefreshButton from "./RefreshButton.vue";
import { navigate } from "../services/router";

const props = defineProps<{ loading: boolean; backLabel: string; inlineSearch?: boolean }>();
const emit = defineEmits<{ back: []; refresh: []; search: [keyword: string] }>();

const refreshing = ref(false);
watch(() => props.loading, loading => {
  if (!loading) refreshing.value = false;
});
async function refresh() {
  refreshing.value = true;
  emit("refresh");
  await nextTick();
  if (!props.loading) refreshing.value = false;
}

const toolbarKeyword = ref("");
function submitToolbarSearch() {
  const q = toolbarKeyword.value.trim();
  if (!q) return;
  if (props.inlineSearch) emit("search", q);
  else navigate("搜索", undefined, "", { q });
}
</script>

<template>
  <button type="button" class="chart-back" :aria-label="backLabel" :title="backLabel" @click="emit('back')">
    <AppIcon name="back" :size="16" />
  </button>
  <RefreshButton class="chart-detail-refresh" :loading="loading && refreshing" :disabled="loading" @click="refresh" />
  <form class="chart-toolbar-search" role="search" @submit.prevent="submitToolbarSearch">
    <button type="submit" aria-label="搜索" title="搜索">
      <AppIcon name="搜索" :size="17" />
    </button>
    <input v-model="toolbarKeyword" type="search" aria-label="搜索音乐" placeholder="搜索音乐" />
  </form>
</template>

<style scoped lang="scss">
.chart-toolbar-search {
  display: flex;
  align-items: center;
  width: 264px;
  height: 34px;
  margin-inline-start: 14px;
  border-radius: 10px;
  background: var(--day-surface-soft, #18201b);
  color: var(--day-muted, #b8c8be);
}
.chart-toolbar-search:focus-within {
  outline: 1px solid var(--green);
}
.chart-toolbar-search button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.chart-toolbar-search input {
  flex: 1;
  min-width: 0;
  margin-inline-end: 10px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--day-text, #c5d5ca);
  font: inherit;
  font-size: 13px;
}
.chart-back,
.chart-detail-refresh.refresh-button {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--day-muted, #b8c8be);
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  .chart-back:hover,
  .chart-detail-refresh.refresh-button:hover:not(:disabled) {
    background: var(--day-surface-soft, #18201b);
    color: var(--day-text, #c5d5ca);
  }
}
@media (max-width: 700px) {
  .chart-back,
  .chart-detail-refresh.refresh-button {
    flex: 0 0 36px;
    width: 36px;
    height: 40px;
  }
  .chart-toolbar-search {
    flex: 1;
    min-width: 0;
    width: auto;
    margin-inline-start: 4px;
  }
  .chart-toolbar-search button {
    flex: 0 0 34px;
  }
  .chart-toolbar-search input {
    width: 0;
    font-size: 16px;
  }
}
</style>
