<script setup lang="ts">
import CatalogCover from "./CatalogCover.vue";
import AppIcon from "./AppIcon.vue";
import type { Chart } from "../stores/chartPreferences";

defineProps<{ chart: Chart; platformName?: string }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button type="button" class="chart-card" @click="emit('open')">
    <div class="chart-art">
      <CatalogCover :name="chart.name" :image="chart.image" />
      <span class="chart-play"><AppIcon name="play" :size="20" /></span>
    </div>
    <div class="chart-card-copy">
      <strong :title="chart.name">{{ chart.name }}</strong>
      <small>
        {{ chart.update || "定期更新" }}<template v-if="chart.count"> · {{ chart.count }} 首</template>
      </small>
      <p>{{ chart.description || `${platformName ?? ""}热门音乐榜单` }}</p>
    </div>
  </button>
</template>

<style scoped lang="scss">
.chart-card {
  display: flex;
  align-items: center;
  color: inherit;
  cursor: pointer;
  min-width: 0;
  text-align: left;
  justify-content: flex-start;
  gap: 14px;
  border: 1px solid var(--day-line, #ffffff0e);
  background: var(--day-surface-soft, #16251b88);
  border-radius: 12px;
  padding: 12px;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.chart-card:hover,
.chart-card:focus-visible {
  background: var(--day-selected, #213d2bcc);
  border-color: #66c78666;
}
.chart-art {
  position: relative;
  width: 76px;
  height: 76px;
  flex: 0 0 76px;
  border-radius: 9px;
  overflow: hidden;
}
.chart-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #0006;
  opacity: 0;
  transition: opacity 0.15s;
}
.chart-card:hover .chart-play,
.chart-card:focus-visible .chart-play {
  opacity: 1;
}
.chart-card-copy {
  min-width: 0;
}
.chart-card-copy strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chart-card-copy small {
  display: block;
  font-size: 12px;
  color: var(--day-muted, #7f9a89);
  margin-top: 7px;
}
.chart-card-copy p {
  font-size: 13px;
  margin-top: 5px;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 700px) {
  .chart-card {
    padding: 10px;
    gap: 12px;
  }
  .chart-art {
    width: 64px;
    height: 64px;
    flex-basis: 64px;
  }
}
</style>
