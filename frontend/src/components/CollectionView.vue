<script setup lang="ts">
import RefreshButton from "./RefreshButton.vue";
import { watch } from "vue";
import type { Track } from "../../../backend/src/contracts";
import { libraryLoading, playbackFallback } from "../stores/library";
import AppIcon from "./AppIcon.vue";
import SongTable from "./SongTable.vue";
const props = defineProps<{
  tracks: Track[];
  query: string;
  currentId?: string;
  playing: boolean;
  favoriteIds: string[];
  local?: boolean;
  hideToolbar?: boolean;
  favorites?: boolean;
  plainEmpty?: boolean;
  trackCount?: number;
  directoryCount?: number;
  artists?: number;
  scanRunning: boolean;
  scanned: number;
}>();
const emit = defineEmits<{
  "update:query": [value: string];
  play: [track: Track, list: Track[]];
  favorite: [track: Track];
  enqueue: [track: Track, next: boolean];
  notify: [message: string];
  navigate: [page: string];
  scan: [];
}>();
watch(
  () => props.tracks,
  (tracks) => {
    playbackFallback.value = tracks;
  },
  { immediate: true },
);
</script>
<template>
  <div class="collection-page">
    <SongTable
      :tracks="tracks"
      :loading="libraryLoading"
      :batch="favorites"
      :batch-remove-favorites="favorites"
      infinite
      :current-id="currentId"
      :playing="playing"
      :favorite-ids="favoriteIds"
      @play="(track, list) => emit('play', track, list)"
      @favorite="emit('favorite', $event)"
      @enqueue="(track, next) => emit('enqueue', track, next)"
      @notify="emit('notify', $event)"
      @navigate="emit('navigate', $event)"
    >
      <template v-if="!hideToolbar" #actions>
        <el-button
          class="primary"
          :disabled="!tracks.length"
          @click="emit('play', tracks[0], tracks)"
          type="primary"
          ><AppIcon name="play" :size="15" />播放全部</el-button
        ><RefreshButton
          v-if="local"
          label="扫描目录"
          :disabled="!directoryCount"
          :loading="scanRunning"
          @click="emit('scan')"
        />
        <slot name="sort" />
        <slot name="actions" />
        <div v-if="local && trackCount !== undefined" class="collection-summary">
          <span
            ><strong>{{ trackCount }}</strong> 本地歌曲</span
          ><span
            ><strong>{{ artists }}</strong> 歌手</span
          ><span
            ><strong>{{ directoryCount }}</strong> 音乐目录</span
          >
        </div>
        <span v-if="scanRunning" class="subtle"
          >正在扫描 · {{ scanned }} 首</span
        >
      </template>
      <template v-if="!hideToolbar" #search>
        <label class="search-input"
          ><AppIcon name="搜索" :size="17" /><el-input
            :model-value="query"
            @update:model-value="emit('update:query', String($event))"
            aria-label="搜索歌曲、歌手、专辑"
            placeholder="搜索歌曲、歌手、专辑"
          /><el-button
            v-if="query"
            aria-label="清空搜索"
            @click="emit('update:query', '')"
            >×</el-button
          ></label
        >
      </template>
      <template #empty>
        <div v-if="plainEmpty && !query.trim()" class="empty-state">
          <h2>暂无数据</h2>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon"><AppIcon :name="favorites ? '我的收藏' : '本地音乐'" :size="40" /></div>
          <h2>
            {{
              query
                ? "没有找到匹配的歌曲"
                : favorites
                  ? "暂无收藏"
                  : "把你的音乐带进来"
            }}
          </h2>
          <p v-if="query.trim() || !favorites">
            {{
              query
                ? "换个关键词再试试。"
                : "添加 NAS 音乐目录，自动整理歌曲、封面与歌词。"
            }}
          </p>
          <el-button v-if="!favorites && !plainEmpty"
            class="primary"
            @click="emit('navigate', '设置')"
            type="primary"
            >添加音乐目录 ＋</el-button
          >
        </div>
      </template>
    </SongTable>
    <!-- <div v-if="!local" class="list-footer">
      {{ tracks.length }} 首歌曲 <span>·</span>
      {{ scanRunning ? "扫描进行中" : "私人音乐，自在聆听" }}
    </div> -->
  </div>
</template>

<style scoped lang="scss">
.primary {
  padding: 11px 18px;
  border-radius: 7px;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
}

.primary {
  background: var(--green);
  color: var(--day-on-accent, #072512);
}

.primary:hover {
  background: var(--day-accent-hover, #68e294);
}

.subtle {
  color: var(--day-muted, #6e7e73);
  font-size: 13px;
}

.search-input {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--day-surface-soft, #161e18);
  border: 1px solid var(--day-line, #2a352d);
  border-radius: 7px;
  padding: 0 13px;
  color: var(--day-muted, #718378);
  width: 100%;
}

.search-input > span {
  font-size: 25px;
}

.search-input input {
  background: none;
  border: 0;
  padding: 10px 0;
  width: 100%;
  font-size: 13px;
}

.search-input input:focus {
  outline: none;
}

.search-input:focus-within {
  border-color: var(--green);
}



.list-footer {
  padding: 24px 14px;
  color: var(--day-muted, #53685b);
  font-size: 12px;
  border-top: 1px solid var(--day-line, #202c23);
  margin-top: 12px;
}

.list-footer span {
  margin: 0 12px;
}

.empty-state {
  min-height: 330px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  border: 1px dashed var(--day-line, #2a3a2e);
  border-radius: 12px;
  background: transparent;
}

.empty-icon {
  width: 80px;
  height: 80px;
  display: grid;
  place-items: center;
  border-radius: 23px;
  background: var(--day-selected, #203426);
  color: var(--day-muted, #73ab84);
  margin-bottom: 22px;
  border: 1px solid var(--day-line, #304b38);
  font-size: 45px;
}

.empty-state h2 {
  font-size: 19px;
}

.empty-state p {
  font-size: 14px;
  margin: 12px 0 23px;
}

@media (max-width: 1100px) {
  .subtle {
    display: none;
  }

}

@media (max-width: 700px) {

  .empty-state {
    min-height: 340px;
    padding: 25px 12px;
  }

  .empty-state p {
    font-size: 13px;
  }

  .empty-state h2 {
    font-size: 17px;
  }
}

.collection-page > :not(.song-table) {
  flex-shrink: 0;
}
.search-input .el-input {
  flex: 1;
  min-width: 0;
}
.search-input :deep(.el-input__wrapper) {
  box-shadow: none;
  background: transparent;
  padding: 0;
}
.search-input :deep(.el-input__inner) {
  width: 100%;
  font-size: 14px;
  padding: 0;
}

.list-footer {
  padding: 10px 14px;
  margin: 0;
  border: 0;
}
.collection-summary {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  color: var(--day-muted, #82998b);
  font-size: 13px;
}
.collection-summary span {
  white-space: nowrap;
}
.collection-summary strong {
  font-size: 14px;
  color: var(--day-text, #b5cbbd);
  font-weight: 500;
  margin-right: 4px;
}
@media (max-width: 900px) {

  .collection-summary {
    gap: 12px;
  }

}
@media (max-width: 700px) {
  .collection-summary {
    flex-basis: 100%;
    column-gap: 12px;
    row-gap: 4px;
  }
  .collection-page :deep(.song-batch-toolbar > span:has(+ .batch-track-actions)) {
    margin-inline-start: auto;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }
  .collection-page :deep(.song-batch-toolbar > .batch-track-actions) {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }
  .collection-page :deep(.batch-track-actions > .el-button) {
    min-width: 0;
    padding-inline: 4px;
    font-size: 13px;
  }
}
</style>
