import { ref, type InjectionKey } from "vue";

export const pausePlaybackKey: InjectionKey<() => void> = Symbol("pausePlayback");

export const playbackLoadingId = ref<string>();

/** Keep delayed play requests from resuming audio after pause or track changes. */
export function createPlaybackControl() {
  let generation = 0;
  const pending = ref(false);
  return {
    get pending() { return pending.value; },
    pause(element?: HTMLAudioElement) {
      generation++;
      pending.value = false;
      element?.pause();
    },
    async play(element: HTMLAudioElement, ready: Promise<unknown> = Promise.resolve()) {
      const request = ++generation;
      pending.value = true;
      try {
        await ready;
        if (request !== generation) return false;
        await element.play();
        return request === generation;
      } catch (error) {
        // Browsers reject a pending play promise when pause/load replaces it.
        if (request !== generation || (error as { name?: string })?.name === 'AbortError') return false;
        throw error;
      } finally {
        if (request === generation) pending.value = false;
      }
    },
  };
}
