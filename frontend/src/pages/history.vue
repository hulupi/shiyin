<script setup lang="ts">
import { computed, ref } from "vue";
import type { Track } from "../../../backend/src/contracts";
import PageLayout from "../components/PageLayout.vue";
import CollectionView from "../components/CollectionView.vue";
import { library } from "../stores/library";
import { useHistoryOrder } from "../stores/useHistoryOrder";
import { currentPage } from "../services/router";
import { confirmAction } from "../services/dialog";
import { requestApi as api } from "../services/api";
import { reportError } from "../services/feedback";
defineProps<{ currentId?: string; playing: boolean; favoriteIds: string[] }>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
const query = ref("");
const historyIds = useHistoryOrder(
  computed(() => library.value.history),
  computed(() => currentPage.value === "播放历史"),
);
const trackIndex = computed(
  () =>
    new Map(
      [...library.value.tracks, ...(library.value.onlineTracks || [])].map(
        (track) => [track.id, track],
      ),
    ),
);
const collection = computed(() =>
  historyIds.value
    .map((id) => trackIndex.value.get(id))
    .filter((track): track is Track => Boolean(track)),
);
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
async function clearHistory() {
  if (!(await confirmAction("清空播放历史？"))) return;
  try {
    library.value.history = await api("/history", { method: "DELETE" });
  } catch (error) {
    reportError(error);
  }
}
</script>
<template>
  <PageLayout floating title="播放历史" description="找回最近听过的音乐">
    <template #actions
      ><el-button class="secondary" @click="clearHistory"
        >清空历史</el-button
      ></template
    >
    <CollectionView
      plain-empty
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
    />
  </PageLayout>
</template>

<style scoped lang="scss">
.secondary {
  padding: 11px 18px;
  border-radius: 7px;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
}

.secondary {
  border: 1px solid var(--day-line, #344239);
  background: var(--day-surface-soft, #18201b);
  color: var(--day-text, #b8c8be);
}
</style>
