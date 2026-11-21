<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{ name: string; image: string; compactTitle?: boolean }>();
const failed = ref(false);

watch(() => [props.name, props.image], () => {
  failed.value = false;
});

const coverColor = computed(() => {
  // FNV-1a keeps the palette independent of platform, list order and refreshes.
  let hash = 2166136261;
  for (const character of props.name.normalize("NFC").trim()) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return `hsl(${(hash >>> 0) % 360} 64% 35%)`;
});
</script>

<template>
  <span class="chart-cover" aria-hidden="true">
    <img
      v-if="image && !failed"
      :src="image"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else class="generated-cover" :style="{ backgroundColor: coverColor }">
      <span class="cover-name" :class="{ compact: compactTitle }">{{ name }}</span>
    </span>
  </span>
</template>

<style scoped>
.chart-cover {
  position: relative;
  display: block;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 9px;
  container-type: inline-size;
}
.chart-cover img,
.generated-cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.chart-cover img {
  object-fit: cover;
}
.generated-cover {
  display: grid;
  place-items: center;
  padding: 10%;
  color: white;
  text-align: center;
}
.cover-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: clamp(10px, 15cqi, 34px);
  font-weight: 800;
  line-height: 1.2;
  text-shadow: 0 1px 4px #0005;
}
.cover-name.compact {
  -webkit-line-clamp: 4;
  font-size: clamp(10px, 10cqi, 23px);
}
</style>
