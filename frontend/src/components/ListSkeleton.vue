<script setup lang="ts">
withDefaults(defineProps<{
  layout?: "rows" | "covers" | "cards";
  count?: number;
  label?: string;
}>(), {
  layout: "rows",
  count: 6,
  label: "正在加载列表",
});
</script>

<template>
  <div class="list-skeleton" :class="`skeleton-${layout}`" role="status" :aria-label="label">
    <div v-for="index in count" :key="index" class="skeleton-entry" aria-hidden="true">
      <el-skeleton-item class="skeleton-art" variant="rect" />
      <div class="skeleton-copy">
        <el-skeleton-item class="skeleton-title" />
        <el-skeleton-item class="skeleton-caption" />
      </div>
      <el-skeleton-item v-if="layout === 'rows'" class="skeleton-meta" />
    </div>
  </div>
</template>

<style scoped>
.list-skeleton {
  min-width: 0;
  width: 100%;
  animation: skeleton-pulse 1.6s ease-in-out infinite alternate;
}
.list-skeleton .el-skeleton__item {
  display: block;
  background: var(--el-fill-color-dark);
}
.skeleton-entry {
  min-width: 0;
}
.skeleton-art {
  border-radius: 8px;
}
.skeleton-copy {
  display: grid;
  flex: 1;
  gap: 7px;
  min-width: 0;
}
.skeleton-title {
  width: 76%;
  max-width: 220px;
  height: 13px;
}
.skeleton-caption {
  width: 48%;
  max-width: 130px;
  height: 10px;
}
.skeleton-covers .skeleton-art {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  margin-bottom: 10px;
}
.skeleton-cards .skeleton-entry,
.skeleton-rows .skeleton-entry {
  display: flex;
  align-items: center;
  gap: 12px;
}
.skeleton-cards .skeleton-entry {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}
.skeleton-cards .skeleton-art {
  flex: 0 0 76px;
  width: 76px;
  height: 76px;
}
.skeleton-rows .skeleton-entry {
  min-height: 60px;
  border-bottom: 1px solid var(--border);
  padding: 8px 12px;
}
.skeleton-rows .skeleton-art {
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
}
.skeleton-meta {
  width: 12%;
  max-width: 72px;
  height: 10px;
  margin-inline-end: 12px;
}
@media (max-width: 700px) {
  .skeleton-cards .skeleton-entry { padding: 10px; }
  .skeleton-cards .skeleton-art {
    flex-basis: 64px;
    width: 64px;
    height: 64px;
  }
}
@keyframes skeleton-pulse {
  from { opacity: .55; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .list-skeleton { animation: none; }
}
</style>
