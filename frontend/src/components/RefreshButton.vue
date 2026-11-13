<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

withDefaults(defineProps<{ label?: string; loading?: boolean; disabled?: boolean }>(), {
  label: "刷新",
});
</script>

<template>
  <button
    type="button"
    class="refresh-button"
    :disabled="loading || disabled"
    :aria-busy="loading"
    :aria-label="label"
    :title="label"
  >
    <AppIcon name="refresh" :size="16" :spinning="loading" />
  </button>
</template>

<style scoped>
.refresh-button {
  box-sizing: border-box;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--day-line, #344239);
  border-radius: 7px;
  background: var(--day-surface-soft, #18201b);
  color: var(--day-text, #b8c8be);
}

.refresh-button:hover:not(:disabled) {
  border-color: var(--green);
  color: var(--green);
}

.refresh-button[aria-busy="true"] {
  cursor: progress;
  opacity: 1;
}
</style>
