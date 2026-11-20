<script setup lang="ts">
import { computed, ref } from "vue";
import type { Track } from "../../../backend/src/contracts";
import PageLayout from "../components/PageLayout.vue";
import CollectionView from "../components/CollectionView.vue";
import { library, scanLibrary } from "../stores/library";
defineProps<{ currentId?: string; playing: boolean; favoriteIds: string[] }>();
const emit = defineEmits<{
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
}>();
const query = ref("");
const sort = ref<"default" | "added-desc" | "added-asc" | "modified-desc">("added-desc");
const collection = computed(() => library.value.tracks);
const artists = computed(
  () => new Set(collection.value.map((track) => track.artist)).size,
);
const tracks = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  const filtered = keyword
    ? collection.value.filter((track) =>
        (track.title + " " + track.artist + " " + track.album)
          .toLowerCase()
          .includes(keyword),
      )
    : collection.value;
  if (sort.value === "default") return filtered;
  if (sort.value === "modified-desc") {
    return [...filtered].sort((a, b) => b.modified - a.modified);
  }
  const direction = sort.value === "added-asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    if (a.addedAt === undefined) return b.addedAt === undefined ? 0 : 1;
    if (b.addedAt === undefined) return -1;
    return direction * (a.addedAt - b.addedAt);
  });
});
</script>
<template>
  <PageLayout
    class="library-page"
    title="本地音乐"
    description="浏览和播放 NAS 中的音乐收藏"
    local
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
      local
      :track-count="library.tracks.length"
      :artists="artists"
      :directory-count="library.directories.length"
      @scan="scanLibrary()"
    >
      <template #sort>
        <el-select v-model="sort" aria-label="本地音乐排序" class="library-sort">
          <el-option label="默认顺序" value="default" />
          <el-option label="添加时间 · 最新优先" value="added-desc" />
          <el-option label="添加时间 · 最早优先" value="added-asc" />
          <el-option label="文件修改时间 · 最新优先" value="modified-desc" />
        </el-select>
      </template>
    </CollectionView>
  </PageLayout>
</template>

<style scoped lang="scss">
.library-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.library-sort {
  width: min(100%, 210px);
}
</style>
