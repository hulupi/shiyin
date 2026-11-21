<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import type { Track } from "../../../backend/src/contracts";
import { useTrackArtwork } from "../stores/useTrackArtwork";
import AppIcon from "./AppIcon.vue";
import { pausePlaybackKey, playbackLoadingId } from "../stores/playbackControl";
const props = defineProps<{
  track: Track;
  playback?: boolean;
  playable?: boolean;
  playing?: boolean;
}>();
const emit = defineEmits<{ play: [] }>();
const loading = computed(() => playbackLoadingId.value === props.track.id);
const pausePlayback = inject(pausePlaybackKey);
const canPause = computed(() => Boolean(pausePlayback) && (loading.value || props.playing));
const label = computed(() =>
  canPause.value ? "暂停 " + props.track.title : "播放 " + props.track.title,
);
function handleClick(event: MouseEvent) {
  if (!props.playable) return;
  event.stopPropagation();
  if (canPause.value) pausePlayback?.();
  else emit("play");
}
const coverRoot = ref<HTMLElement>();
const visible = ref(false);
const { artwork, artworkError } = useTrackArtwork(() => props.track, () => visible.value);
let observer: IntersectionObserver | undefined;
onMounted(() => {
  if (!coverRoot.value || !("IntersectionObserver" in window)) {
    visible.value = true;
    return;
  }
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      visible.value = true;
      observer?.disconnect();
    }
  }, { rootMargin: "80px" });
  observer.observe(coverRoot.value);
});
onUnmounted(() => observer?.disconnect());
</script>
<template>
  <component
    :is="playable ? 'button' : 'div'"
    ref="coverRoot"
    class="cover"
    :class="{ 'cover-playable': playable, 'cover-playback-active': playback && (loading || playing) }"
    :type="playable ? 'button' : undefined"
    :aria-label="playable ? label : undefined"
    :aria-busy="playback && loading ? true : undefined"
    @click="handleClick"
    @dblclick="playable && $event.stopPropagation()"
  >
    <img
      v-if="artwork"
      :src="artwork"
      :alt="track.title + ' 封面'"
      loading="lazy"
      @error="artworkError"
    /><AppIcon v-else name="music" :size="23" />
    <span v-if="playback" class="cover-playback">
      <span v-if="loading" role="status" aria-label="正在加载"><AppIcon name="refresh" :size="17" spinning /></span>
      <span v-else-if="playing" class="cover-playing" role="img" aria-label="正在播放">
        <i></i><i></i><i></i>
      </span>
      <AppIcon v-else name="play" :size="17" fill="currentColor" />
    </span>
  </component>
</template>

<style scoped lang="scss">
.cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: #24342a;
  color: #6c997b;
  flex-shrink: 0;
  overflow: hidden;
  font-size: 24px;
  position: relative;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-playable {
  border: 0;
  padding: 0;
  cursor: pointer;
}

.cover-playback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: white;
  background: rgb(0 0 0 / 28%);
  opacity: 0;
}

.cover-playback-active .cover-playback,
.cover-playable:hover .cover-playback,
.cover-playable:focus-visible .cover-playback,
button:hover .cover-playback,
button:focus-visible .cover-playback {
  opacity: 1;
}

@media (hover: none) {
  .cover-playback { opacity: 1; }
}

.cover-playing {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 16px;
  color: var(--green);
}

.cover-playing i {
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: currentColor;
  transform-origin: bottom;
  animation: cover-equalizer 0.8s ease-in-out infinite alternate;
}

.cover-playing i:nth-child(2) { animation-delay: -0.45s; }
.cover-playing i:nth-child(3) { animation-delay: -0.2s; }

@keyframes cover-equalizer {
  from { transform: scaleY(0.35); }
  to { transform: scaleY(1); }
}

@media (prefers-reduced-motion: reduce) {
  .cover-playing i { animation: none; }
  .cover-playing i:nth-child(2) { height: 55%; }
}
</style>
