<script setup lang="ts">
import { Pencil } from "lucide-vue-next";
import type { Track } from "../../../backend/src/contracts";
import PlaylistCover from "./PlaylistCover.vue";
import AppIcon from "./AppIcon.vue";
defineProps<{
  name: string;
  count: number;
  firstTrack?: Track;
  loading?: boolean;
}>();
const emit = defineEmits<{ open: []; play: []; rename: []; remove: [] }>();
</script>
<template>
  <article class="playlist-card">
    <button
      class="playlist-open"
      :aria-label="'打开歌单 ' + name"
      @click="emit('open')"
    >
      <PlaylistCover :track="firstTrack" :empty="count === 0" />
      <span class="playlist-name" :title="name">{{ name }}</span>
      <span class="playlist-count">{{ count }} 首歌曲</span>
    </button>
    <el-button
      class="card-play"
      :class="{ 'empty-play': count === 0 }"
      :aria-label="'播放歌单 ' + name"
      :disabled="count === 0 || loading"
      :loading="loading"
      circle
      @click="emit('play')"
      ><AppIcon v-if="!loading" name="play" :size="17" fill="currentColor"
    /></el-button>
    <el-button
      class="card-rename"
      :aria-label="'重命名歌单 ' + name"
      title="重命名歌单"
      circle
      @click="emit('rename')"
      ><Pencil :size="15"
    /></el-button>
    <el-button
      class="card-delete"
      :aria-label="'删除歌单 ' + name"
      :title="'删除歌单 ' + name"
      circle
      @click="emit('remove')"
      ><AppIcon name="trash" :size="15"
    /></el-button>
  </article>
</template>
<style scoped lang="scss">
.playlist-card {
  position: relative;
  min-width: 0;
}
.playlist-open {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  padding: 0;
  gap: 0;
  border-radius: 9px;
  text-align: left;
  background: transparent;
  color: var(--day-text, #e9edea);
  &:focus-visible {
    outline: 2px solid var(--green);
    outline-offset: 5px;
  }
}
.playlist-name {
  display: block;
  margin-top: 12px;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playlist-count {
  margin-top: 4px;
  font-size: 13px;
  color: var(--day-muted, #8ba693);
  line-height: 1.5;
}
.card-play.el-button {
  position: absolute;
  right: 12px;
  top: calc(100% - 104px);
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  background: #44d17a;
  color: #0a2a17;
  opacity: 0;
  transform: translateY(5px);
  transition:
    opacity 0.18s,
    transform 0.18s;
  box-shadow: 0 4px 16px #0003;
}
.card-delete.el-button,
.card-rename.el-button {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--day-line, #ffffff22);
  background: var(--day-surface-soft, #101b16b8);
  color: var(--day-text, #e6eee8);
  opacity: 0;
  transition: opacity 0.18s;
  backdrop-filter: blur(8px);
}
.card-rename.el-button {
  right: 46px;
}
.playlist-card:hover,
.playlist-card:focus-within {
  .card-play,
  .card-rename,
  .card-delete {
    opacity: 1;
    transform: translateY(0);
  }
  .playlist-name {
    color: var(--day-accent-text, #a6efbf);
  }
}
.card-play.empty-play {
  opacity: 1;
  transform: none;
  background: var(--day-selected, #355640);
  color: var(--day-text, #b6d1bc);
}
@media (hover: none) {
  .card-play.el-button,
  .card-rename.el-button,
  .card-delete.el-button {
    opacity: 1;
    transform: none;
  }
}
</style>
