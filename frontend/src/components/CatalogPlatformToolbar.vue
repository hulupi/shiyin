<script setup lang="ts">
import RefreshButton from "./RefreshButton.vue";

defineProps<{
  modelValue: string;
  platforms: { id: string; name: string }[];
  loading: boolean;
  label: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [id: string];
  refresh: [];
}>();

function selectPlatform(id: string | number | boolean) {
  if (typeof id === "string") emit("update:modelValue", id);
}
</script>

<template>
  <div class="catalog-platform-toolbar">
    <div class="music-segmented-scroll">
      <el-segmented
        class="music-segmented"
        :model-value="modelValue"
        :options="platforms"
        :props="{ value: 'id', label: 'name' }"
        :aria-label="label"
        @change="selectPlatform"
      />
    </div>
    <RefreshButton class="platform-refresh" :loading="loading" @click="emit('refresh')" />
  </div>
</template>

<style scoped>
.catalog-platform-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 24px;
}
.platform-refresh {
  margin-inline-start: auto;
}

@media (max-width: 700px) {
  .catalog-platform-toolbar {
    gap: 6px;
    margin-bottom: 18px;
  }
}
</style>
