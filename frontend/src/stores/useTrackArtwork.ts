import { computed, ref, watch } from "vue";
import type { Track } from "../../../backend/src/contracts";
import { loadKuwoArtwork } from "../android/artwork";
import { trackCover } from "../services/music";
import { isAndroidOnline } from "../services/platform";

export function useTrackArtwork(track: () => Track | null, visible: () => boolean = () => true) {
  const direct = computed(() => {
    const item = track();
    return item?.online || item?.hasCover ? trackCover(item) : "";
  });
  const fallback = ref("");
  const failed = ref<string[]>([]);
  const artwork = computed(() => {
    const url = direct.value && !failed.value.includes(direct.value) ? direct.value : fallback.value;
    return failed.value.includes(url) ? "" : url;
  });

  watch([() => track()?.id, direct], () => {
    fallback.value = "";
    failed.value = [];
  }, { flush: "sync" });

  watch([() => track()?.id, direct, failed, visible], ([id, initial, broken, shouldLoad], _old, onCleanup) => {
    if (!isAndroidOnline || !shouldLoad || !id?.startsWith("online:kw:") || (initial && !broken.includes(initial))) return;
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    void loadKuwoArtwork(id).then(url => {
      if (!cancelled) fallback.value = url;
    }).catch(() => {});
  }, { immediate: true });

  function artworkError(event: Event) {
    const image = event.currentTarget as HTMLImageElement | null;
    if (artwork.value && image?.getAttribute("src") === artwork.value) failed.value = [...failed.value, artwork.value];
  }

  return { artwork, artworkError };
}
