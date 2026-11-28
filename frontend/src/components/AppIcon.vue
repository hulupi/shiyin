<script setup lang="ts">
import {
  Menu,
  Trash2,
  Tags,
  FileText,
  Check,
  Music2,
  Home,
  Search,
  Heart,
  ListMusic,
  FolderOpen,
  History,
  Settings,
  Download,
  ChartNoAxesCombined,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Repeat,
  Repeat1,
  Shuffle,
  ListOrdered,
  List,
  RefreshCw,
  Plus,
  X,
  Disc3,
  ArrowRight,
  ChevronLeft,
  UserRound,
  EllipsisVertical,
} from "lucide-vue-next";
import type { Component } from "vue";
defineProps<{ name: string; size?: number; spinning?: boolean }>();
const icons: Record<string, Component> = {
  首页: Home,
  搜索: Search,
  榜单: ChartNoAxesCombined,
  发现歌单: Disc3,
  本地音乐: FolderOpen,
  我的收藏: Heart,
  我的歌单: ListMusic,
  下载管理: Download,
  播放历史: History,
  设置: Settings,
  menu: Menu,
  trash: Trash2,
  tags: Tags,
  lyrics: FileText,
  check: Check,
  music: Music2,
  play: Play,
  pause: Pause,
  previous: SkipBack,
  next: SkipForward,
  volume: Volume2,
  列表循环: Repeat,
  单曲循环: Repeat1,
  随机播放: Shuffle,
  顺序播放: ListOrdered,
  queue: List,
  refresh: RefreshCw,
  back: ChevronLeft,
  artist: UserRound,
  moreVertical: EllipsisVertical,
  plus: Plus,
  close: X,
  arrow: ArrowRight,
  heart: Heart,
};
</script>
<template>
  <component
    :is="icons[name] || Music2"
    class="app-icon"
    :class="{ 'app-icon-spinning': spinning }"
    :size="size || 19"
    :stroke-width="1.7"
    aria-hidden="true"
  />
</template>

<style scoped lang="scss">
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}

.app-icon-spinning {
  animation: icon-spin 0.8s linear infinite;
}

@keyframes icon-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .app-icon-spinning { animation-duration: 2s; }
}
</style>
