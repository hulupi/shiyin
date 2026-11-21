<script setup lang="ts">
import { ref, watch } from "vue";
import type { Track } from "../../../backend/src/contracts";
import { trackCover } from "../services/music";
import AppIcon from "./AppIcon.vue";
const props = defineProps<{ track?: Track; empty?: boolean }>();
const failed = ref(false);
watch(
  () => props.track?.id,
  () => {
    failed.value = false;
  },
);
</script>
<template>
  <div class="playlist-cover" :class="{ 'animated-cover': empty }">
    <template v-if="empty">
      <span class="color-wave wave-one" aria-hidden="true"></span>
      <span class="color-wave wave-two" aria-hidden="true"></span>
      <span class="cover-heart" aria-hidden="true"
        ><AppIcon
          class="heart-icon"
          name="heart"
          :size="56"
          fill="currentColor"
          :stroke-width="0"
      /></span>
    </template>
    <img
      v-else-if="track && (track.hasCover || track.online) && !failed"
      :src="trackCover(track)"
      alt=""
      loading="lazy"
      @error="failed = true"
    />
    <AppIcon v-else class="fallback-icon" name="music" :size="52" />
  </div>
</template>
<style scoped lang="scss">
.playlist-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  isolation: isolate;
  border-radius: 9px;
  background: #294333;
  display: grid;
  place-items: center;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.fallback-icon {
  color: #8cb69a;
}
.animated-cover {
  background: #23382c;
}
.color-wave {
  position: absolute;
  pointer-events: none;
  width: 155%;
  height: 150%;
  border-radius: 45%;
  filter: blur(16px);
  will-change: transform;
}
.wave-one {
  left: -60%;
  top: 35%;
  background: #365742;
  animation: forest-drift 13s ease-in-out infinite alternate;
}
.wave-two {
  left: 22%;
  top: 12%;
  background: #2c4739;
  animation: mist-drift 16s ease-in-out infinite alternate;
}
.cover-heart {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  color: #a6c5a2;
}
.heart-icon {
  animation: heart-breathe 4s ease-in-out infinite;
}
@keyframes forest-drift {
  from {
    transform: translate(-8%, 3%) rotate(-28deg);
  }
  to {
    transform: translate(12%, -18%) rotate(16deg);
  }
}
@keyframes mist-drift {
  from {
    transform: translate(10%, 8%) rotate(-18deg);
  }
  to {
    transform: translate(-13%, -10%) rotate(26deg);
  }
}
@keyframes heart-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.86;
  }
  50% {
    transform: scale(1.09);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .color-wave,
  .heart-icon {
    animation: none;
    will-change: auto;
  }
}
</style>
