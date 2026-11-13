<script setup lang="ts">
import { computed, ref } from "vue";
import type { Track } from "../../../backend/src/contracts";
import PageLayout from "../components/PageLayout.vue";
import CollectionView from "../components/CollectionView.vue";
import { library } from "../stores/library";
defineProps<{ currentId?: string; playing: boolean; favoriteIds: string[] }>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
const query = ref("");
const collection = computed(() => {
  const ids = new Set(library.value.favorites);
  return [
    ...library.value.tracks,
    ...(library.value.onlineTracks || []),
  ].filter((track) => ids.has(track.id));
});
const tracks = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return keyword
    ? collection.value.filter((track) =>
        (track.title + " " + track.artist + " " + track.album)
          .toLowerCase()
          .includes(keyword),
      )
    : collection.value;
});
</script>
<template>
  <PageLayout
    floating
    title="我的收藏"
    description="喜欢的每一首，都收藏在这里"
  >
    <CollectionView
      v-model:query="query"
      :tracks="tracks"
      :current-id="currentId"
      :playing="playing"
      :favorite-ids="favoriteIds"
      :scan-running="library.scan.running"
      :scanned="library.scan.scanned"
      @play="(track, list) => emit('play', track, list)"
      @favorite="emit('favorite', $event)"
      @enqueue="(track, next) => emit('enqueue', track, next)"
      @notify="emit('notify', $event)"
      @navigate="emit('navigate', $event)"
      favorites
    />
  </PageLayout>
</template>
