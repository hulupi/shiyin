<script setup lang="ts">
import { preferredVariant, trackCover, variantQualityName } from "../services/music";
import { cachedKuwoArtwork } from "../android/artwork";
import { useTrackArtwork } from "../stores/useTrackArtwork";
import { androidPlayback, type AndroidPlaybackItem, type AndroidPlaybackState } from "../android/playback";
import { isAndroidOnline } from "../services/platform";
import { appUrl } from "../services/urls";
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import type { Track } from "../../../backend/src/contracts";
import AppIcon from "./AppIcon.vue";
import TrackCover from "./TrackCover.vue";
import ListPagination from "./ListPagination.vue";
import { usePagination } from "../stores/usePagination";
import { useAudioSpectrum } from "../stores/useAudioSpectrum";
import { createPlaybackControl, playbackLoadingId } from "../stores/playbackControl";
import { connectSystemMediaSession } from "../stores/systemMediaSession";
const mediaControl = createPlaybackControl();
import {
  library,
  preferredQuality,
  playbackFallback,
  refreshLibrary as refresh,
  toggleFavorite as favorite,
} from "../stores/library";
import { requestApi as api } from "../services/api";
import { loadPlaybackDownloadSettings, playbackDownloadSettings } from "../stores/playbackDownload";
import { notify, reportError as message, inform } from "../services/feedback";
const emit = defineEmits<{
  current: [track: Track | null];
  playing: [value: boolean];
}>();
const fallbackTracks = computed(
  () => playbackFallback.value ?? library.value.tracks,
);
const notice = ref("");
watch(
  notice,
  (text) => {
    if (text) {
      inform(text);
      notice.value = "";
    }
  },
  { flush: "sync" },
);
const current = ref<Track | null>(null),
  queue = ref<Track[]>([]),
  audio = ref<HTMLAudioElement>(),
  playing = ref(false),
  progress = ref(0),
  duration = ref(0),
  volume = ref(0.7),
  showLyrics = ref(false),
  showQueue = ref(false),
  lyricText = ref("");
const { spectrumCanvas, lyricSpectrumCanvas, prepareSpectrum } =
  useAudioSpectrum(audio, playing);
let lyricRequest = 0;
const playbackUrl = ref(""),
  playbackSource = ref("本地"),
  playbackQuality = ref(""),
  resolving = ref(false),
  buffering = ref(false);
watch(
  () => (resolving.value || buffering.value || mediaControl.pending) ? current.value?.id : undefined,
  (id) => (playbackLoadingId.value = id),
);
let playbackController: AbortController | undefined;
let playbackDownloadAttempted = false;
const BUFFER_TIMEOUT_MS = 15000;
let recoveredFromBufferTimeout = false;

watch(buffering, (waiting, _, onCleanup) => {
  if (!waiting || isAndroidOnline) return;
  const request = lyricRequest;
  const timer = window.setTimeout(() => {
    const track = current.value;
    const media = audio.value;
    if (request !== lyricRequest || !track || !media || media.paused || media.ended ||
        media.currentSrc !== media.src || !playbackUrl.value) return;

    if (recoveredFromBufferTimeout) {
      pausePlayback();
      next(1, true, true);
      return;
    }

    recoveredFromBufferTimeout = true;
    const position = restorePosition ?? media.currentTime;
    void play(track, false, true, position);
  }, BUFFER_TIMEOUT_MS);
  onCleanup(() => window.clearTimeout(timer));
}, { flush: "sync" });
onMounted(() => {
  if (!isAndroidOnline && !playbackDownloadSettings.value) {
    void loadPlaybackDownloadSettings().catch(() => {});
  }
});
let usedSourceId = "";
let playbackActivityId: string | undefined;
let playbackActivityReported = false;
let failedSources: string[] = [];
let refreshedSource = false;
let nextQueuedId: string | undefined;

const {
  currentPage: queuePage,
  pageSize: queueSize,
  total: queueTotal,
  pagedItems: pagedQueue,
  resize: resizeQueue,
} = usePagination(queue);
const playbackMode = ref("列表循环");
let nativeId = "";
let nativeFinished = "";
let prefetchController: AbortController | undefined;
const preparedTracks: { item: AndroidPlaybackItem; track: Track; result: OnlinePlayback }[] = [];
let clearingUpcoming = false;
const { artwork, artworkError } = useTrackArtwork(() => current.value);

interface OnlinePlayback {
  audioUrl: string;
  lyricUrl: string;
  sourceId: string;
  sourceName: string;
  quality: string;
  mode: string;
  audioVariant?: Parameters<typeof variantQualityName>[0];
  activityId?: string;
}

function nativeItem(track: Track, path: string): AndroidPlaybackItem {
  return {
    id: crypto.randomUUID(), trackId: track.id, path, title: track.title, artist: track.artist,
    album: track.album, artwork: cachedKuwoArtwork(track.id) || trackCover(track) || undefined,
  };
}

function requestOnlinePlayback(track: Track, signal: AbortSignal, exclude: string[] = [], retry = false, activityId?: string, quality = preferredQuality.value): Promise<OnlinePlayback> {
  return api("/online/" + encodeURIComponent(track.id) + "/resolve", {
    method: "POST",
    body: JSON.stringify({
      quality, exclude, skipLocal: retry,
      onlineOnly: isAndroidOnline, activityId,
    }),
    signal,
  });
}

function updateLyrics(url: string, request: number, signal?: AbortSignal) {
  void api(url, { signal }).then(result => {
    if (request === lyricRequest) lyricText.value = result.text;
  }).catch(() => {});
}

function runNative(action: Parameters<typeof androidPlayback.control>[0]["action"], value?: number, enabled?: boolean) {
  if (!nativeId) return;
  void androidPlayback.control({ action, value, enabled }).then(applyNativeState).catch(message);
}

function cancelPrefetch() {
  prefetchController?.abort();
  prefetchController = undefined;
}

function prefetchOrder(after: Track) {
  const list = queue.value;
  const index = list.findIndex(track => track.id === after.id);
  const tail = list.slice(index + 1);
  const wrap = playbackMode.value !== "顺序播放" ? list.slice(0, index + 1) : [];
  const remaining = playbackMode.value === "随机播放" ? [...list] : [...tail, ...wrap];
  if (playbackMode.value === "随机播放") {
    for (let i = remaining.length - 1; i > 0; i--) {
      const swap = Math.floor(Math.random() * (i + 1));
      [remaining[i], remaining[swap]] = [remaining[swap], remaining[i]];
    }
  }
  const forced = list.find(track => track.id === nextQueuedId);
  const seen = new Set(preparedTracks.map(entry => entry.track.id));
  if (current.value && list.length > 1) seen.add(current.value.id);
  return (forced ? [forced, ...remaining] : remaining).filter(track => {
    if (!track.online || !track.available || seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

async function syncServiceQueue() {
  if (!isAndroidOnline || !nativeId) return;
  const { getOnlineTrack } = await import('../../../backend/src/modules/catalog/service');
  const { read } = await import('../android/storage');
  const tracks = queue.value.filter(track => track.online && track.available).map(track => getOnlineTrack(track.id));
  await androidPlayback.configureQueue({ tracks, sources: read<unknown[]>('sources', []), quality: preferredQuality.value, mode: playbackMode.value, nextId: nextQueuedId });
}
async function prepareNext() {
  if (isAndroidOnline) return;
  if (!nativeId || !current.value || resolving.value || !playing.value || prefetchController || clearingUpcoming) return;
  const repeat = playbackMode.value === "单曲循环" && !nextQueuedId;
  runNative("repeat", undefined, repeat);
  if (repeat) return;

  const tail = preparedTracks.at(-1);
  let tailId = tail?.item.id ?? nativeId;
  const controller = new AbortController();
  prefetchController = controller;
  try {
    const order = prefetchOrder(tail?.track ?? current.value);
    // Give Media3 the rest of this pass while WebView can resolve sources.
    // It can then advance through the prepared items without a JS callback.
    for (const track of order) {
      if (controller.signal.aborted) break;
      let result: OnlinePlayback;
      try { result = await requestOnlinePlayback(track, controller.signal); }
      catch { continue; }
      if (controller.signal.aborted) break;

      const item = nativeItem(track, appUrl(result.audioUrl));
      const entry = { item, track, result };
      preparedTracks.push(entry);
      const applied = await androidPlayback.append({ afterId: tailId, ...item })
        .then(response => response.applied).catch(() => false);
      if (!applied) {
        const index = preparedTracks.indexOf(entry);
        if (index >= 0) preparedTracks.splice(index, 1);
        break;
      }
      tailId = item.id;
    }
  } finally {
    if (prefetchController === controller) {
      prefetchController = undefined;
      runNative("state");
    }
  }
}

async function refreshUpcoming() {
  if (isAndroidOnline) { await syncServiceQueue().catch(message); return; }
  cancelPrefetch();
  const owner = nativeId;
  if (!owner || clearingUpcoming) return;
  clearingUpcoming = true;
  try {
    const { applied } = await androidPlayback.clearUpcoming({ currentId: owner });
    if (applied && nativeId === owner) preparedTracks.length = 0;
  } catch (error) {
    message(error);
  } finally {
    clearingUpcoming = false;
    void prepareNext();
  }
}

function applyNativeState(state: AndroidPlaybackState) {
  if (!state.id || !nativeId) return;
  if (state.serviceQueue && state.id !== nativeId) {
    const track = queue.value.find(track => track.id === state.trackId);
    if (!track) return;
    if (track.id === nextQueuedId) nextQueuedId = undefined;
    nativeId = state.id;
    playing.value = false;
    current.value = track;
    progress.value = state.position;
    duration.value = state.duration || track.duration;
    playbackActivityReported = false;
    failedSources = [];
    refreshedSource = false;
    updateLyrics('/online/' + encodeURIComponent(track.id) + '/lyrics', ++lyricRequest);
  }
  if (state.id !== nativeId) {
    const index = preparedTracks.findIndex(entry => entry.item.id === state.id);
    if (index < 0) return;
    const { track, result, item } = preparedTracks[index];
    const consumed = preparedTracks.splice(0, index + 1);
    if (consumed.some(entry => entry.track.id === nextQueuedId)) nextQueuedId = undefined;
    nativeId = item.id;
    playing.value = false;
    current.value = track;
    playbackUrl.value = item.path;
    playbackSource.value = result.sourceName;
    playbackQuality.value = result.quality;
    usedSourceId = result.sourceId;
    playbackActivityReported = false;
    refreshedSource = false;
    failedSources = [];
    lyricText.value = "";
    duration.value = track.duration;
    updateLyrics(result.lyricUrl.replace(/^\/api/, ""), ++lyricRequest);
  }
  progress.value = state.position;
  if (state.duration > 0) duration.value = state.duration;
  buffering.value = state.buffering;
  if (state.playing && !playing.value) {
    recordPlay();
    void prepareNext();
  } else if (!state.playing) playing.value = false;

  if (state.serviceQueue) return;
  // The pending item can still extend an exhausted native queue.
  if (state.ended && prefetchController) return;
  if (!resolving.value && (state.ended || state.failed) && nativeFinished !== state.id) {
    nativeFinished = state.id;
    if (state.failed) playbackError();
    else next(1, true);
  }
}

if (isAndroidOnline) {
  watch([queue, playbackMode], () => { void refreshUpcoming(); }, { deep: true });
  onMounted(() => {
    const listening = androidPlayback.addListener("state", applyNativeState);
    void listening.catch(message);
    const timer = setInterval(() => {
      if (nativeId && !document.hidden && (playing.value || buffering.value)) runNative("state");
    }, 500);
    const refill = setInterval(() => {
      if (preparedTracks.length < 2) void prepareNext();
    }, 20000);
    const onVisibility = () => {
      if (!document.hidden) { runNative("state"); void prepareNext(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    removeNativeListener = () => {
      clearInterval(timer);
      clearInterval(refill);
      document.removeEventListener("visibilitychange", onVisibility);
      void listening.then(listener => listener.remove()).catch(() => {});
      cancelPrefetch();
    };
  });
  let removeNativeListener: (() => void) | undefined;
  onUnmounted(() => removeNativeListener?.());
}

type PlaybackSnapshot = {
  queue: Track[];
  current: Track | null;
  progress: number;
  mode: string;
  nextQueuedId?: string;
};
const desktopPlayback = (window as Window & {
  desktopPlayback?: {
    read: () => PlaybackSnapshot | null;
    save: (state: PlaybackSnapshot) => boolean;
  };
}).desktopPlayback;
let restorePosition: number | undefined;
let lastSavedProgress = 0;

function savePlayback() {
  if (!desktopPlayback) return;
  if (desktopPlayback.save(JSON.parse(JSON.stringify({
    queue: queue.value.map((track) => ({ ...track })),
    current: current.value ? { ...current.value } : null,
    progress: restorePosition ?? progress.value,
    mode: playbackMode.value,
    nextQueuedId,
  })))) lastSavedProgress = progress.value;
}

if (desktopPlayback) {
  const saved = desktopPlayback.read();
  if (saved) {
    queue.value = saved.queue;
    current.value = saved.current;
    duration.value = saved.current?.duration ?? 0;
    progress.value = saved.progress;
    restorePosition = saved.current ? saved.progress : undefined;
    playbackMode.value = saved.mode;
    nextQueuedId = saved.nextQueuedId;
  }

  watch([queue, current, playbackMode, playing], savePlayback, { deep: true });
  watch(progress, (value) => {
    if (Math.abs(value - lastSavedProgress) >= 5) savePlayback();
  });
  onMounted(() => window.addEventListener("beforeunload", savePlayback));
  onUnmounted(() => window.removeEventListener("beforeunload", savePlayback));
}

const lyricContainer = ref<HTMLElement>();
const followLyrics = ref(true);
function scrollCurrentLyric(smooth = true) {
  const container = lyricContainer.value;
  const line = container?.querySelector<HTMLElement>('[data-active="true"]');
  if (!container || !line) return;
  const containerRect = container.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
  const top =
    container.scrollTop +
    lineRect.top -
    containerRect.top -
    container.clientTop -
    (container.clientHeight - lineRect.height) / 2;
  container.scrollTo({
    top: Math.max(0, top),
    behavior: smooth ? "smooth" : "instant",
  });
}
function followCurrentLyric() {
  followLyrics.value = true;
  void nextTick(() => scrollCurrentLyric());
}
function switchMode() {
  const modes = ["列表循环", "单曲循环", "随机播放", "顺序播放"];
  playbackMode.value =
    modes[(modes.indexOf(playbackMode.value) + 1) % modes.length];
}

const lyricLines = computed(() =>
  lyricText.value
    .split(/\r?\n/)
    .flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)],
        text = line.replace(/\[[^\]]*\]/g, "").trim();
      return matches.length
        ? matches.map((m) => ({ time: Number(m[1]) * 60 + Number(m[2]), text }))
        : text
          ? [{ time: -1, text }]
          : [];
    })
    .sort((a, b) => a.time - b.time),
);
const activeLine = computed(() => {
  let index = -1;
  lyricLines.value.forEach((line, i) => {
    if (line.time >= 0 && line.time <= progress.value) index = i;
  });
  return index;
});
watch(
  [activeLine, lyricText],
  () => {
    if (showLyrics.value && followLyrics.value) scrollCurrentLyric();
  },
  { flush: "post" },
);
watch(
  showLyrics,
  (open) => {
    if (open) {
      followLyrics.value = true;
      scrollCurrentLyric(false);
    }
  },
  { flush: "post" },
);
watch(
  () => current.value?.id,
  () => {
    followLyrics.value = true;
  },
);
function deletingTrackFile(event: Event) {
  const id = (event as CustomEvent<string>).detail;
  if (
    current.value?.id !== id &&
    !playbackUrl.value.startsWith(appUrl("/api/tracks/" + encodeURIComponent(id) + "/"))
  )
    return;
  playbackController?.abort();
  lyricRequest++;
  mediaControl.pause(audio.value);
  audio.value?.removeAttribute("src");
  audio.value?.load();
  current.value = null;
  playbackUrl.value = "";
  playing.value = false;
  resolving.value = false;
  buffering.value = false;
  progress.value = 0;
  duration.value = 0;
  lyricText.value = "";
}
function removeQueuedTrack(id: string) {
  if (nextQueuedId === id) nextQueuedId = undefined;
  queue.value = queue.value.filter(track => track.id !== id);
}
function deletedTrackFile(event: Event) {
  removeQueuedTrack((event as CustomEvent<string>).detail);
  void refresh();
}
onMounted(() => {
  window.addEventListener("track-file-deleting", deletingTrackFile);
  window.addEventListener("track-file-deleted", deletedTrackFile);
});
onUnmounted(() => {
  playbackController?.abort();
  lyricRequest++;
  mediaControl.pause(audio.value);
  playbackLoadingId.value = undefined;
  window.removeEventListener("track-file-deleting", deletingTrackFile);
  window.removeEventListener("track-file-deleted", deletedTrackFile);
});
const playbackQualityLabel = computed(() => {
  if (!playbackUrl.value || resolving.value) return "";
  switch (playbackQuality.value) {
    case "flac24bit": return "Hi-Res";
    case "flac": return "FLAC";
    case "320k": return "320 kbps";
    case "128k": return "128 kbps";
    default: return playbackQuality.value;
  }
});

async function play(track: Track, replace = true, retry = false, position?: number, quality?: string) {
  if (!track.available) {
    notice.value = "文件暂不可用，请检查目录后重新扫描";
    return;
  }
  playbackController?.abort();
  const controller = new AbortController();
  playbackController = controller;
  const request = ++lyricRequest;
  if (isAndroidOnline) {
    cancelPrefetch();
    preparedTracks.length = 0;
    runNative("pause");
    nativeId = "";
  }
  if (replace) queue.value = [...fallbackTracks.value];
  mediaControl.pause(audio.value);
  playing.value = false;
  buffering.value = false;
  restorePosition = position;
  current.value = track;
  progress.value = position ?? 0;
  duration.value = track.duration;
  lyricText.value = "";
  playbackUrl.value = "";
  playbackActivityReported = false;
  if (!retry) {
    recoveredFromBufferTimeout = false;
    playbackDownloadAttempted = false;
    playbackActivityId = undefined;
    failedSources = [];
    refreshedSource = false;
    usedSourceId = "";
  }
  const audioReady = isAndroidOnline ? Promise.resolve() : prepareSpectrum();
  audioReady.catch(() => {});
  resolving.value = true;
  try {
    let lyricUrl = "/tracks/" + encodeURIComponent(track.id) + "/lyrics";
    if (track.online) {
      const result = await requestOnlinePlayback(track, controller.signal, failedSources, retry, playbackActivityId, quality);
      if (request !== lyricRequest) return;
      usedSourceId = result.sourceId || "";
      playbackActivityId = result.activityId;
      playbackSource.value = result.sourceName;
      playbackQuality.value = result.mode === "local" && result.audioVariant
        ? variantQualityName(result.audioVariant)
        : result.quality;
      playbackUrl.value = appUrl(result.audioUrl);
      lyricUrl = result.lyricUrl.replace(/^\/api/, "");
    } else {
      playbackSource.value = "本地";
      playbackQuality.value = variantQualityName(preferredVariant(track));
      playbackUrl.value =
        appUrl("/api/tracks/" + encodeURIComponent(track.id) + "/audio");
    }
    await nextTick();
    await audioReady;
    if (request !== lyricRequest) return;
    if (isAndroidOnline) {
      const item = nativeItem(track, playbackUrl.value);
      nativeId = item.id;
      buffering.value = true;
      await androidPlayback.start({ ...item, position: position ?? 0, volume: volume.value });
      await syncServiceQueue();
      if (request === lyricRequest) restorePosition = undefined;
    } else if (audio.value) {
      audio.value.volume = volume.value;
      await mediaControl.play(audio.value);
    }
    if (request !== lyricRequest) return;
    updateLyrics(lyricUrl, request, controller.signal);
    if (track.online) void refresh();
  } catch (e) {
    if (!controller.signal.aborted && request === lyricRequest) {
      buffering.value = false;
      if (isAndroidOnline) nativeId = "";
      const unsupportedAudio = e instanceof Error && e.name === "NotSupportedError";
      if (!isAndroidOnline && track.online && playbackUrl.value && unsupportedAudio) {
        if (usedSourceId) {
          const qualities = ["flac24bit", "flac", "320k", "128k"];
          const index = qualities.indexOf(playbackQuality.value);
          const lowerQuality = index >= 0 ? qualities[index + 1] : undefined;
          if (lowerQuality) {
            void play(track, false, true, position, lowerQuality);
            return;
          }
        } else if (!retry) {
          notice.value = "本地文件无法解码，正在尝试在线音源…";
          void play(track, false, true, position);
          return;
        }
        reportPlaybackFailure();
        notice.value = "音频无法解码，请切换音源后重试。";
        return;
      }
      if (playbackUrl.value) reportPlaybackFailure();
      message(e);
    }
  } finally {
    if (request === lyricRequest) {
      resolving.value = false;
      if (isAndroidOnline) {
        runNative("state");
        if (playing.value) void prepareNext();
      }
    }
  }
}
function playOnline(track: Track, list: Track[]) {
  queue.value = [...list];
  void play(track, false);
}
function enqueue(track: Track, asNext = false) {
  const existing = queue.value.findIndex((item) => item.id === track.id);
  if (existing >= 0 && current.value?.id === track.id) {
    notice.value = "这首歌曲正在播放";
    return;
  }
  if (existing >= 0) queue.value.splice(existing, 1);
  if (asNext) {
    nextQueuedId = track.id;
    const index = queue.value.findIndex(
      (item) => item.id === current.value?.id,
    );
    queue.value.splice(index < 0 ? 0 : index + 1, 0, track);
  } else queue.value.push(track);
  notify(asNext ? "已设为下一首播放" : "已加入播放队列");
}
function reportPlaybackFailure() {
  if (!current.value?.online || !playbackActivityId) return;
  void api("/online/" + encodeURIComponent(current.value.id) + "/playback-failed", {
    method: "POST",
    body: JSON.stringify({ activityId: playbackActivityId }),
  }).catch(() => {});
}
function playbackError() {
  buffering.value = false;
  if (resolving.value || !playbackUrl.value || !current.value) return;
  playing.value = false;
  if (isAndroidOnline && current.value.online && usedSourceId && !refreshedSource) {
    refreshedSource = true;
    notice.value = "音频连接中断，正在重新取链…";
    void play(current.value, false, true, progress.value);
    return;
  }
  if (current.value.online && usedSourceId && !failedSources.includes(usedSourceId) && failedSources.length < 20) {
    failedSources.push(usedSourceId);
    notice.value = "当前文件无法播放，正在尝试下一音源…";
    void play(current.value, false, true);
  } else {
    reportPlaybackFailure();
    notice.value = "音频暂时无法播放，请检查文件或浏览器格式支持。";
  }
}
function pausePlayback() {
  playbackController?.abort();
  lyricRequest++;
  resolving.value = false;
  buffering.value = false;
  mediaControl.pause(audio.value);
  if (isAndroidOnline) runNative("pause");
  playing.value = false;
}
async function resumePlayback() {
  if (resolving.value || mediaControl.pending || (audio.value && !audio.value.paused)) return;
  if (!current.value) {
    const first = queue.value[0] || fallbackTracks.value[0];
    if (first) void play(first, !queue.value.length);
    return;
  }
  if (!playbackUrl.value || (isAndroidOnline && !nativeId)) {
    void play(current.value, false, false, restorePosition);
    return;
  }
  if (isAndroidOnline) runNative("play");
  else if (audio.value) {
    recoveredFromBufferTimeout = false;
    try {
      await mediaControl.play(audio.value, prepareSpectrum());
    } catch (e) {
      message(e);
    }
  }
}
function toggle() {
  if (resolving.value || buffering.value || playing.value || mediaControl.pending || (audio.value && !audio.value.paused)) pausePlayback();
  else void resumePlayback();
}

function recordPlay() {
  buffering.value = false;
  playing.value = true;
  if (!current.value || (isAndroidOnline && playbackActivityReported)) return;
  const logPlayback = !playbackActivityReported;
  playbackActivityReported = true;
  api("/history/" + encodeURIComponent(current.value.id), {
    method: "POST",
    body: JSON.stringify({
      logPlayback,
      activityId: logPlayback ? playbackActivityId : undefined,
    }),
  })
    .then((ids) => (library.value.history = ids))
    .catch(message);
}
function pickNext(delta: number, ended: boolean, skipCurrent = false) {
  if (!queue.value.length) return;
  const index = queue.value.findIndex((t) => t.id === current.value?.id);
  if (
    ended &&
    playbackMode.value === "顺序播放" &&
    index === queue.value.length - 1 &&
    !nextQueuedId
  ) {
    return;
  }
  const forced =
    delta === 1
      ? queue.value.findIndex((item) => item.id === nextQueuedId)
      : -1;
  if (skipCurrent && forced < 0 && playbackMode.value === "随机播放") {
    const alternatives = queue.value.filter(track => track.available && track.id !== current.value?.id);
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }
  const target =
    forced >= 0
      ? forced
      : playbackMode.value === "随机播放"
        ? Math.floor(Math.random() * queue.value.length)
        : (index + delta + queue.value.length) % queue.value.length;
  return queue.value[target];
}
function next(delta = 1, ended = false, skipCurrent = false) {
  if (!skipCurrent && ended && playbackMode.value === "单曲循环" && !nextQueuedId) {
    seek(0);
    if (isAndroidOnline) runNative("play");
    else if (audio.value) void mediaControl.play(audio.value).catch(message);
    return;
  }
  if (isAndroidOnline && !ended && delta === 1 && nativeId) {
    runNative("next");
    return;
  }
  const track = (delta === 1 ? preparedTracks[0]?.track : undefined) ?? pickNext(delta, ended, skipCurrent);
  if (!track || (skipCurrent && (track.id === current.value?.id || !track.available))) return false;
  if (delta === 1 && track.id === nextQueuedId) nextQueuedId = undefined;
  void play(track, false);
  return true;
}

watch(volume, (value) => { if (isAndroidOnline) runNative("volume", Number(value)); });

function seek(value: number) {
  if (isAndroidOnline && Number.isFinite(value)) {
    progress.value = value;
    runNative("seek", value);
  } else if (audio.value && Number.isFinite(value)) {
    const length = audio.value.duration;
    audio.value.currentTime = Math.max(0, Number.isFinite(length) ? Math.min(length, value) : value);
    progress.value = audio.value.currentTime;
  }
}
function checkPlaybackDownload() {
  const settings = playbackDownloadSettings.value;
  const track = current.value;
  const media = audio.value;
  if (!settings?.autoDownloadPlayback || playbackDownloadAttempted || !track?.online ||
      !media || !playbackUrl.value || media.currentSrc !== media.src ||
      !Number.isFinite(media.duration) || media.duration <= 0) return;

  let secondsPlayed = 0;
  const ranges = media.played;
  for (let index = 0; index < ranges.length; index++) {
    secondsPlayed += ranges.end(index) - ranges.start(index);
  }
  // Audio end timestamps can differ slightly from the declared duration.
  const complete = media.ended && secondsPlayed > 0 &&
    media.duration - secondsPlayed <= Math.min(0.05, media.duration * 0.001);
  const percent = complete ? 100 : Math.min(100, secondsPlayed / media.duration * 100);
  if (percent < settings.playbackDownloadPercent) return;

  playbackDownloadAttempted = true;
  void api("/downloads/playback", {
    method: "POST",
    body: JSON.stringify({ trackId: track.id, percent }),
  }).catch(error => message(new Error("完播下载失败：" + error.message)));
}
function updateAudioProgress() {
  progress.value = audio.value?.currentTime || 0;
  checkPlaybackDownload();
}
function onAudioEnded() {
  buffering.value = false;
  checkPlaybackDownload();
  next(1, true);
}
function loadedMetadata() {
  duration.value = Number.isFinite(audio.value?.duration) ? audio.value!.duration : 0;
  if (restorePosition === undefined) return;
  const position = restorePosition;
  restorePosition = undefined;
  seek(position);
}
function clock(n: number) {
  return `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, "0")}`;
}
function key(event: KeyboardEvent) {
  if (
    event.code === "Space" &&
    !["INPUT", "TEXTAREA", "BUTTON"].includes(
      (event.target as HTMLElement)?.tagName,
    )
  ) {
    event.preventDefault();
    toggle();
  }
}

let systemMedia: ReturnType<typeof connectSystemMediaSession> | undefined;
function syncSystemMedia() {
  const track = current.value;
  systemMedia?.update(track ? {
    id: track.id, title: track.title, artist: track.artist, album: track.album,
    artwork: track.hasCover ? trackCover(track) : undefined,
  } : null, playing.value, duration.value, progress.value, audio.value?.playbackRate || 1);
}
watch([current, playing, duration, progress], syncSystemMedia);
onMounted(() => {
  if (isAndroidOnline) return;
  systemMedia = connectSystemMediaSession({
    play: () => { void resumePlayback(); },
    pause: pausePlayback,
    previous: () => next(-1),
    next: () => next(1),
    stop: () => { pausePlayback(); seek(0); },
    seek,
    position: () => audio.value?.currentTime || 0,
  });
  syncSystemMedia();
});
onUnmounted(() => systemMedia?.dispose());

watch(current, (track) => emit("current", track));
watch(playing, (value) => emit("playing", value));
onMounted(() => window.addEventListener("keydown", key));
onUnmounted(() => {
  playbackController?.abort();
  window.removeEventListener("keydown", key);
});
defineExpose({ play: playOnline, enqueue, pause: pausePlayback });
</script>
<template>
  <el-drawer
    v-model="showQueue"
    title="播放队列"
    size="min(420px, 100vw)"
    append-to-body
    class="queue-drawer"
    ><p v-if="!queue.length" class="subtle">播放一首歌曲，开始创建队列。</p>
    <div v-for="track in pagedQueue" :key="track.id" class="queue-item">
      <el-button
        class="queue-row"
        :class="{ selected: current?.id === track.id }"
        @click="current?.id === track.id && (playing || playbackLoadingId === track.id) ? pausePlayback() : play(track, false)"
      >
        <TrackCover :track="track" playback :playing="playing && current?.id === track.id" />
        <div>{{ track.title }}<small>{{ track.artist }}</small></div>
      </el-button>
      <button
        type="button"
        class="queue-remove"
        :aria-label="'从队列移除 ' + track.title"
        title="移除"
        @click="removeQueuedTrack(track.id)"
      ><AppIcon name="close" :size="16" /></button>
    </div>
    <ListPagination
      v-model:page="queuePage"
      :page-size="queueSize"
      :total="queueTotal"
      compact
      @update:page-size="resizeQueue"
  /></el-drawer>
  <el-dialog
    v-model="showLyrics"
    fullscreen
    :show-close="false"
    :close-on-click-modal="false"
    append-to-body
    @opened="followCurrentLyric"
    class="lyrics-dialog"
    title="正在播放"
    modal-class="lyrics-modal"
    :modal="false"
  >
    <section class="lyrics-overlay">
      <el-button
        class="close-lyrics icon-button"
        aria-label="关闭歌词"
        @click="showLyrics = false"
        >×</el-button
      >
      <div class="lyrics-workspace">
        <div class="lyric-art">
          <div class="lyric-info">
            <div class="large-cover">
              <img
                v-if="artwork"
                :src="artwork"
                @error="artworkError"
                alt="歌曲封面"
              /><AppIcon v-else name="music" :size="24" />
              <span v-if="resolving" class="player-cover-loading" role="status" aria-label="正在加载歌曲">
                <AppIcon name="refresh" :size="28" spinning />
              </span>
            </div>
            <h1>{{ current?.title || "还没有播放歌曲" }}</h1>
            <p>{{ current?.artist || "选择音乐，开始聆听" }}</p>
          </div>
          <div class="lyric-transport">
            <el-button
              class="icon-button"
              :aria-label="playbackMode"
              :title="playbackMode"
              @click="switchMode"
              text
              ><AppIcon :name="playbackMode" /></el-button
            >
            <el-button
              class="icon-button"
              aria-label="上一首"
              @click="next(-1)"
              text
              ><AppIcon name="previous"
            /></el-button>
            <el-button
              class="play-button"
              :aria-label="resolving ? '取消加载' : playing ? '暂停' : '播放'"
              @click="toggle"
              ><AppIcon
                :name="playing ? 'pause' : 'play'"
                :size="24"
                fill="currentColor"
            /></el-button>
            <el-button
              class="icon-button"
              aria-label="下一首"
              @click="next()"
              text
              ><AppIcon name="next"
            /></el-button>
            <el-button
              class="icon-button"
              :disabled="!current"
              :class="{
                liked: current && library.favorites.includes(current.id),
              }"
              aria-label="收藏当前歌曲"
              @click="current && favorite(current)"
              text
              ><AppIcon name="heart"
            /></el-button>
            <div class="lyric-volume">
              <AppIcon name="volume" :size="18" /><el-slider
                v-model="volume"
                aria-label="音量"
                :min="0"
                :max="1"
                :step="0.01"
                :show-tooltip="false"
                @input="audio&amp;&amp;(audio.volume=Number(volume))"
              />
            </div>
          </div>
        </div>
        <div class="lyrics-column">
          <div
            ref="lyricContainer"
            class="lyric-scroll"
            @wheel="followLyrics = false"
            @touchstart="followLyrics = false"
          >
            <p v-if="!lyricLines.length" class="subtle">暂无歌词</p>
            <el-button
              v-for="(line, index) in lyricLines"
              :key="index"
              :class="{ current: index === activeLine }"
              :data-active="index === activeLine"
              :disabled="line.time < 0"
              @click="seek(line.time)"
              >{{ line.text || "♪" }}</el-button
            >
          </div>
          <el-button
            v-if="!followLyrics"
            class="follow-lyrics secondary"
            @click="followCurrentLyric"
            >回到当前歌词</el-button
          >
        </div>
        <div class="lyric-timeline">
          <canvas
            ref="lyricSpectrumCanvas"
            class="lyric-spectrum"
            aria-hidden="true"
          ></canvas>
          <div class="lyric-progress">
            <span>{{ clock(progress) }}</span
            ><el-slider
              aria-label="播放进度"
              :min="0"
              :max="duration || 1"
              :model-value="progress"
              :step="0.1"
              :show-tooltip="false"
              @input="seek(Number($event))"
            /><span>{{ clock(duration) }}</span>
          </div>
        </div>
      </div>
    </section>
  </el-dialog>
  <footer
    v-show="!showLyrics"
    class="player"
    :style="{ '--player-progress': `${duration > 0 ? Math.min(100, Math.max(0, progress / duration * 100)) : 0}%` }"
  >
    <canvas
      ref="spectrumCanvas"
      class="audio-spectrum"
      aria-hidden="true"
    ></canvas>
    <div class="cover player-cover" :class="{ spinning: playing }">
      <img v-if="artwork" :src="artwork" alt="" @error="artworkError" /><AppIcon
        v-else
        name="music"
        :size="24"
      />
      <span v-if="resolving" class="player-cover-loading" role="status" aria-label="正在加载歌曲">
        <AppIcon name="refresh" :size="20" spinning />
      </span>
    </div>
    <div class="now-title" :title="playbackSource">
      <div class="now-title-line">
        <strong>{{ current?.title || "准备好，听点音乐" }}</strong>
        <span
          v-if="playbackQualityLabel"
          class="playback-quality"
          :aria-label="'播放音质 ' + playbackQualityLabel"
        >{{ playbackQualityLabel }}</span>
      </div>
      <div class="track-details">
        <small>{{ current?.artist || "你的 NAS 私人音乐空间" }}</small>
        <span v-if="duration > 0" class="track-time">
          {{ clock(progress) }} / {{ clock(duration) }}
        </span>
      </div>
    </div>
    <button
      type="button"
      class="open-lyrics"
      aria-label="打开歌词模式"
      aria-haspopup="dialog"
      :title="playbackSource || '打开歌词模式'"
      @click="showLyrics = true"
    ></button>
    <div class="controls">
      <el-button
        class="icon-button mode-button"
        :title="playbackMode"
        :aria-label="playbackMode"
        @click="switchMode"
        text
        ><AppIcon :name="playbackMode" :size="17" /></el-button
      ><el-button
        class="icon-button"
        aria-label="上一首"
        @click="next(-1)"
        text
        ><AppIcon name="previous" /></el-button
      ><el-button
        class="play-button"
        :aria-label="resolving ? '取消加载' : playing ? '暂停' : '播放'"
        @click="toggle"
        ><AppIcon
          :name="playing ? 'pause' : 'play'"
          :size="21"
          fill="currentColor" /></el-button
      ><el-button class="icon-button" aria-label="下一首" @click="next()" text
        ><AppIcon name="next" /></el-button
      >
    </div>
    <div class="progress">
      <el-slider
        aria-label="播放进度"
        :min="0"
        :max="duration || 1"
        :model-value="progress"
        :step="0.1"
        :show-tooltip="false"
        @input="seek(Number($event))"
      />
    </div>
    <div class="player-right">
      <el-button
        v-if="current"
        class="icon-button"
        :class="{ liked: library.favorites.includes(current.id) }"
        aria-label="收藏当前歌曲"
        @click="favorite(current)"
        text
        ><AppIcon
          name="heart"
          :size="18"
          :fill="
            library.favorites.includes(current.id) ? 'currentColor' : 'none'
          "
      /></el-button>
      <el-button
        class="icon-button lyrics-button"
        :class="{ liked: showLyrics }"
        aria-label="歌词"
        @click="showLyrics = !showLyrics"
        text
        >词</el-button
      ><el-button
        class="icon-button"
        :class="{ liked: showQueue }"
        aria-label="播放队列"
        @click="showQueue = !showQueue"
        text
        ><AppIcon name="queue" /></el-button
      ><AppIcon name="volume" :size="18" /><el-slider
        v-model="volume"
        aria-label="音量"
        :min="0"
        :max="1"
        :step="0.01"
        :show-tooltip="false"
        @input="audio&amp;&amp;(audio.volume=Number(volume))"
      />
    </div>
  </footer>
  <audio
    v-if="!isAndroidOnline"
    ref="audio"
    :src="playbackUrl || undefined"
    @playing="recordPlay"
    @waiting="buffering = Boolean(audio && !audio.paused)"
    @stalled="buffering = Boolean(audio && !audio.paused && audio.readyState < 3)"
    @pause="playing = false; buffering = false"
    @timeupdate="updateAudioProgress"
    @ratechange="syncSystemMedia"
    @loadedmetadata="loadedMetadata"
    @ended="onAudioEnded"
    @error="playbackError"
  />
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

.subtle {
  color: var(--day-muted, #6e7e73);
  font-size: 13px;
}

.cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--day-selected, #2b4232);
  color: var(--day-muted, #6c997b);
  flex-shrink: 0;
  overflow: hidden;
  font-size: 24px;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.icon-button {
  color: var(--day-muted, #87998d);
  position: relative;
  padding: 7px;
  border-radius: 5px;
  flex-shrink: 0;
  font-size: 22px;
  line-height: 1;
}

.icon-button:hover {
  color: var(--day-text, #dcebe1);
  background: var(--day-surface-soft, #26332b);
}

.liked {
  color: var(--green) !important;
}

.player {
  position: fixed;
  inset: auto 0 0;
  height: 108px;
  border-top: 1px solid var(--day-line, #2b382e);
  background: var(--day-surface-soft, #161e19f5);
  backdrop-filter: blur(20px);
  z-index: 30;
  display: grid;
  grid-template-columns: 1fr minmax(300px, 1.2fr) 1fr;
  align-items: center;
  gap: 30px;
  padding: 0 26px;
}

.now-playing {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}

.player-cover,
.large-cover {
  position: relative;
}
.player-cover-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: inherit;
  color: white;
  background: rgb(0 0 0 / 48%);
  pointer-events: none;
}
.player-cover {
  width: 55px;
  height: 55px;
  border-radius: 7px;
}

.now-title {
  min-width: 0;
  max-width: 220px;
}

.now-title strong {
  font-size: 14px;
  font-weight: 500;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-title small {
  color: var(--day-muted, #778c7e);
  font-size: 12px;
  display: block;
  margin-top: 7px;
}

.now-playing > .icon-button {
  margin-left: 10px;
}

.player-center {
  max-width: 600px;
  width: 100%;
  justify-self: center;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 17px;
  margin-bottom: 11px;
}

.controls .icon-button {
  font-size: 18px;
}

.play-button {
  background: #e1f2e6;
  color: #102b19;
  width: 35px;
  height: 35px;
  border-radius: 50%;
  padding: 0;
  font-size: 18px;
}

.play-button:hover {
  background: #fff;
  transform: scale(1.04);
}

.local-indicator {
  color: var(--day-muted, #60ad78);
  font-size: 12px;
  width: 30px;
}

.progress {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--day-muted, #7e9787);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.progress input {
  flex: 1;
  width: 100%;
}

.player-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  color: var(--day-muted, #91a898);
}

.player-right .icon-button {
  font-size: 17px;
}

.player-right input {
  width: 85px;
}

.queue-row {
  display: flex;
  gap: 16px;
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  padding: 12px 8px;
  border-radius: 6px;
  font-size: 14px;
}

.queue-row small {
  display: block;
  font-size: 12px;
  color: var(--day-muted, #71907c);
  margin-top: 2px;
}

.lyrics-overlay {
  position: fixed;
  inset: 0 0 108px 224px;
  z-index: 25;
  background: var(--day-surface-soft, #111a14);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 50px;
  align-items: center;
  padding: 70px;
  overflow: hidden;
}

.close-lyrics {
  position: absolute;
  right: 30px;
  top: 25px;
  font-size: 30px;
}

.large-cover {
  width: min(30vw, 320px);
  aspect-ratio: 1;
  border-radius: 15px;
  display: grid;
  place-items: center;
  background: var(--day-selected, #263e2e);
  color: var(--day-muted, #75a986);
  box-shadow: 0 25px 60px #0005;
  margin-bottom: 30px;
  overflow: hidden;
  font-size: 120px;
}

.large-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lyric-art h1 {
  font-size: 25px;
}

.lyric-art p {
  font-size: 14px;
  margin-top: 12px;
}

.lyric-scroll {
  max-height: 65vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 23px;
  scroll-behavior: smooth;
}

.lyric-scroll button {
  justify-content: flex-start;
  text-align: left;
  color: var(--day-muted, #6c8374);
  font-size: 19px;
  line-height: 1.7;
  flex-shrink: 0;
  opacity: 1;
}

.lyric-scroll button.current {
  color: var(--day-accent-text, #75e69d);
  font-size: 23px;
}

@media (max-width: 1100px) {
  .player {
    grid-template-columns: 1fr 1.2fr;
    gap: 20px;
  }

  .player-right {
    display: none;
  }

  .lyrics-overlay {
    left: 190px;
    padding: 40px;
    gap: 25px;
  }
}

@media (max-width: 700px) {
  .player {
    height: 94px;
    padding: 12px 13px;
    grid-template-columns: minmax(0, 1fr) 100px;
    gap: 12px;
    align-items: start;
  }

  .now-playing {
    gap: 9px;
    padding-top: 5px;
  }

  .player-cover {
    width: 39px;
    height: 39px;
  }

  .now-title strong {
    font-size: 12px;
  }

  .now-title small {
    font-size: 12px;
  }

  .now-playing > .icon-button {
    display: none;
  }

  .player-center {
    position: static;
  }

  .controls {
    gap: 5px;
    margin: 5px 0;
  }

  .controls > .icon-button:nth-child(2),
  .local-indicator {
    display: none;
  }

  .controls .play-button {
    height: 33px;
    width: 33px;
  }

  .progress {
    position: absolute;
    bottom: 10px;
    left: 15px;
    right: 15px;
    font-size: 12px;
  }

  .lyrics-overlay {
    inset: 0 0 94px 62px;
    display: flex;
    flex-direction: column;
    padding: 55px 22px 20px;
    gap: 25px;
    overflow: auto;
  }

  .lyric-art {
    text-align: center;
  }

  .large-cover {
    width: 130px;
    margin: 0 auto 15px;
    font-size: 65px;
  }

  .lyric-art h1 {
    font-size: 19px;
  }

  .lyric-art p {
    font-size: 13px;
    margin-top: 5px;
  }

  .lyric-scroll {
    width: 100%;
    max-height: none;
    flex: 1;
    min-height: 120px;
    gap: 18px;
  }

  .lyric-scroll button {
    font-size: 14px;
    justify-content: center;
    text-align: center;
  }

  .lyric-scroll button.current {
    font-size: 17px;
  }

  .close-lyrics {
    right: 12px;
    top: 13px;
  }
}

.follow-lyrics {
  position: absolute;
  right: 10%;
  bottom: 25px;
}

.large-cover > svg {
  width: 40%;
  height: 40%;
}

@media (max-width: 700px) {
  .controls .mode-button {
    display: none;
  }
}
.lyrics-overlay {
  min-height: 0;
}

.lyric-scroll {
  height: min(60vh, calc(100dvh - 260px));
  min-height: 0;
  max-height: none;
  padding-block: min(25vh, 180px);
  overscroll-behavior: contain;
  overflow-anchor: none;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
  position: relative;
}

.lyric-scroll button {
  min-height: 36px;
  font-size: 20px;
  transition: color 0.2s;
}

.lyric-scroll button.current {
  font-size: 20px;
  font-weight: 600;
}

@media (max-width: 700px) {
  .lyrics-overlay {
    overflow: hidden;
  }

  .lyric-art {
    flex-shrink: 0;
  }

  .lyric-scroll {
    height: 0;
    min-height: 0;
    flex: 1 1 0;
    padding-block: 60px;
  }

  .lyric-scroll button,
  .lyric-scroll button.current {
    font-size: 16px;
  }
}
.player {
  height: 132px;
}

.lyrics-overlay {
  bottom: 132px;
}

.player-center {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.audio-spectrum {
  display: block;
  width: 100%;
  height: 34px;
  flex: 0 0 34px;
  order: 0;
  pointer-events: none;
  margin-bottom: 5px;
}

.player-center .progress {
  order: 1;
}

.player-center .controls {
  order: 2;
  margin: 9px 0 0;
  gap: 17px;
}

@media (max-width: 700px) {
  .player {
    height: 118px;
  }

  .lyrics-overlay {
    bottom: 118px;
  }

  .audio-spectrum {
    position: absolute;
    bottom: 27px;
    left: 15px;
    width: calc(100% - 30px);
    height: 18px;
    margin: 0;
  }

  .player-center .controls {
    margin: 5px 0;
    gap: 5px;
  }
}

.lyrics-overlay {
  overflow: hidden;
  overscroll-behavior: none;
}

.lyric-scroll {
  overflow-x: hidden;
  overflow-y: auto;
}
.lyrics-overlay {
  --lyrics-right-inset: 70px;
}

.lyric-scroll {
  min-width: 0;
  width: calc(100% + var(--lyrics-right-inset));
  margin-right: calc(-1 * var(--lyrics-right-inset));
  padding-right: var(--lyrics-right-inset);
}

@media (max-width: 1100px) {
  .lyrics-overlay {
    --lyrics-right-inset: 40px;
  }
}

@media (max-width: 700px) {
  .lyrics-overlay {
    --lyrics-right-inset: 22px;
  }

  .lyric-scroll {
    align-self: flex-start;
  }
}

.local-indicator {
  width: auto;
  min-width: 30px;
  white-space: nowrap;
}

.app-shell > .player {
  position: fixed;
  inset: auto 0 0;
  width: 100%;
  height: var(--player-height);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  grid-template-columns: minmax(0, 1fr) minmax(300px, 1.2fr) minmax(0, 1fr);
}

:global(.lyrics-dialog.el-dialog) {
  height: calc(100dvh - var(--player-height));
}

@media (max-width: 1100px) {
  .app-shell > .player {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 1.2fr);
  }
}

@media (max-width: 700px) {
  .app-shell > .player {
    grid-template-columns: minmax(0, 1fr) 100px;
  }
}
.queue-row.el-button,
.lyric-scroll :deep(.el-button),
.icon-button.el-button,
.play-button.el-button {
  border: 0;
  background: none;
  margin: 0;
  height: auto;
}
.queue-row.el-button > :deep(span),
.lyric-scroll :deep(.el-button > span),
.icon-button.el-button > :deep(span) {
  display: contents;
}
.icon-button.el-button {
  padding: 7px;
  color: var(--day-muted, #87998d);
}
.icon-button.el-button:hover {
  background: var(--day-surface-soft, #26332b);
  color: var(--day-text, #dcebe1);
}
.play-button.el-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  padding: 0;
  background: #f0f6f2;
  color: #14251a;
}
:global(.queue-drawer .el-drawer__header) {
  margin-bottom: 8px;
}
:global(.queue-drawer .el-drawer__body) {
  padding-top: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--day-scrollbar, #34513e) transparent;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.queue-item + .queue-item {
  margin-top: 2px;
}
.queue-remove {
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--day-muted);
}
.queue-row.el-button {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  gap: 10px;
  justify-content: flex-start;
  padding: 3px 8px;
  border-radius: var(--song-row-radius);
  text-align: left;
  white-space: normal;
}
.queue-row.el-button :deep(.cover) {
  width: 36px;
  height: 36px;
}
.queue-row.el-button:hover,
.queue-row.el-button:focus-visible {
  background: var(--song-row-highlight);
}
.queue-row.el-button.selected {
  color: var(--green);
}
:global(.lyrics-modal) {
  pointer-events: none;
}
:global(.lyrics-modal .el-overlay-dialog) {
  pointer-events: none;
}
:global(.lyrics-dialog.el-dialog) {
  pointer-events: auto;
  height: calc(100dvh - 108px);
  padding: 0;
  margin: 0;
  overflow: hidden;
}
:global(.lyrics-dialog .el-dialog__header) {
  display: none;
}
:global(.lyrics-dialog .el-dialog__body) {
  padding: 0;
  height: 100%;
}
:global(.lyrics-dialog .lyrics-overlay) {
  position: relative;
  inset: auto;
  height: 100%;
  width: 100%;
}
.lyric-scroll :deep(.el-button) {
  display: block;
  width: 100%;
  white-space: normal;
  text-align: left;
  line-height: 1.8;
  padding: 12px 0;
}
.lyric-scroll :deep(.el-button.is-disabled) {
  opacity: 0.55;
}
.player :deep(.el-slider) {
  height: 16px;
  flex: 1;
  min-width: 0;
}
.player :deep(.el-slider__runway) {
  height: 4px;
  margin: 0;
  background: var(--day-surface-soft, #2a3b30);
}
.player :deep(.el-slider__bar) {
  height: 4px;
}
.player :deep(.el-slider__button-wrapper) {
  top: -16px;
}
.player :deep(.el-slider__button) {
  width: 9px;
  height: 9px;
  border: 0;
  background: var(--green);
}
.player-right :deep(.el-slider) {
  flex: 0 0 80px;
}
@media (max-width: 700px) {
  :global(.lyrics-dialog.el-dialog) {
    height: calc(100dvh - 132px);
  }
}
.app-shell > .player {
  height: 76px;
  padding: 0 20px;
  gap: 18px;
  border: 1px solid rgb(190 228 203 / 22%);
  border-bottom-color: rgb(171 235 194 / 52%);
  border-radius: 48px;
  background-color: var(--day-surface-soft, #202d25);
  // background-image:
  //   radial-gradient(ellipse at 9% 115%, rgb(89 193 157 / 45%), transparent 42%),
  //   radial-gradient(ellipse at 50% 135%, rgb(157 229 182 / 42%), transparent 48%),
  //   radial-gradient(ellipse at 94% 120%, rgb(82 172 119 / 43%), transparent 44%),
  //   linear-gradient(110deg, rgb(65 139 115 / 18%), rgb(114 171 131 / 16%));
  box-shadow:
    0 12px 36px rgb(0 0 0 / 34%),
    inset 0 1px rgb(255 255 255 / 12%),
    inset 0 -1px 1px rgb(206 249 221 / 38%);
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    background-color: var(--day-player-glass, rgb(19 30 24 / 42%));
    -webkit-backdrop-filter: blur(26px) saturate(145%);
    backdrop-filter: blur(26px) saturate(145%);
  }
  height: var(--desktop-player-bar-height);
  border-radius: 45px;
  padding: 10px 20px;
  --cover-size: 46px;
  grid-template-columns: var(--cover-size) minmax(0, 1fr) auto minmax(0, 1fr) var(--cover-size);
  grid-template-areas: "cover track transport actions actions";
  grid-template-rows: minmax(0, 1fr);
  align-items: center;
  gap: 4px 12px;
  isolation: isolate;
}
.player .audio-spectrum {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0.82;
  border-radius: inherit;
  z-index: -1;
}
.player .player-cover {
  grid-area: cover;
  width: var(--cover-size);
  height: var(--cover-size);
  border-radius: 50%;
  animation: player-cover-spin 18s linear infinite paused;
}
.player .player-cover.spinning {
  animation-play-state: running;
}
@keyframes player-cover-spin {
  to { transform: rotate(1turn); }
}
@media (prefers-reduced-motion: reduce) {
  .player .player-cover {
    animation: none;
  }
}
.now-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.now-title-line > strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playback-quality {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  color: var(--quality-badge-text);
  background: var(--quality-badge-surface);
  font-size: 10px;
  line-height: 15px;
  white-space: nowrap;
}
.player .now-title {
  grid-area: track;
  max-width: none;
}
.player .open-lyrics {
  position: absolute;
  grid-column: cover-start / track-end;
  grid-row: cover-start / cover-end;
  inset: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.player .open-lyrics:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.player .track-details {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 4px;
}
.player .track-time {
  flex-shrink: 0;
  color: var(--day-muted, rgb(225 240 231 / 64%));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.player .now-title small {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player .controls {
  grid-area: transport;
  justify-self: center;
  gap: 6px;
  margin: 0;
}
.player .controls > .icon-button {
  display: inline-flex;
}
.player .controls > :deep(.el-button),
.player .player-right > :deep(.el-button) {
  flex: 0 0 30px;
  width: 30px;
  height: 32px;
  padding: 0;
  margin: 0;
}
.player .controls > .play-button {
  flex-basis: 36px;
  width: 36px;
  height: 36px;
}
.player .local-indicator {
  display: none;
}
.player .progress {
  position: absolute;
  inset: auto 0 0;
  height: 16px;
}
.player::after {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  border-bottom: 2px solid #a9efc3;
  clip-path: inset(0 calc(100% - var(--player-progress, 0%)) 0 0);
  pointer-events: none;
  z-index: 1;
}

.player .progress :deep(.el-slider__runway) {
  height: 16px;
}
.player .progress :deep(.el-slider__button-wrapper) {
  top: -10px;
}
.player .progress :deep(.el-slider__runway),
.player .progress :deep(.el-slider__bar),
.player .progress :deep(.el-slider__button) {
  background: transparent;
}
.player .progress :deep(.el-slider__button-wrapper:focus-visible .el-slider__button) {
  background: #a9efc3;
  outline: 2px solid var(--day-line, #173528);
}
.player .player-right {
  display: flex;
  grid-area: actions;
  gap: 4px;
}
.player-right :deep(.el-slider) {
  flex-basis: 48px;
}
@media (max-width: 1100px) {
  .player .player-right > svg,
  .player .player-right :deep(.el-slider) {
    display: none;
  }
}
@media (max-width: 700px) {
  .app-shell > .player {
    --cover-size: 36px;
    height: var(--mobile-player-bar-height);
    padding: 0 10px 8px;
    grid-template-columns: var(--cover-size) minmax(0, 1fr) auto auto;
    grid-template-areas: "cover track transport actions";
    grid-template-rows: minmax(0, 1fr);
    gap: 6px;
  }
  .player .audio-spectrum {
    inset: auto 0 0;
    height: 32px;
  }
  .player .track-details {
    gap: 5px;
    margin-top: 2px;
  }
  .player .player-right > .lyrics-button {
    display: none;
  }
  .player .track-time {
    white-space: nowrap;
  }
  .player .progress {
    inset: 0 0 auto;
  }
  .player::after {
    border-bottom: 0;
    border-top: 2px solid var(--day-accent-text, #a9efc3);
  }
  .player .controls,
  .player .player-right {
    gap: 2px;
  }
  .player .controls > .mode-button {
    display: none;
  }
  .player .controls > .play-button {
    width: 40px;
    height: 40px;
    flex-basis: 40px;
  }
  .player .player-right > :deep(.el-button) {
    width: 34px;
    height: 40px;
    flex-basis: 34px;
  }
}
:global(.lyrics-dialog.el-dialog) {
  height: 100dvh;
  width: 100%;
  background: var(--day-surface-soft, #101a14);
}
:global(.lyrics-dialog .lyrics-overlay) {
  display: flex;
  justify-content: center;
  padding: 56px 32px 24px;
  background: var(--day-surface-soft, #101a14);
}
.lyrics-workspace {
  width: min(1100px, 100%);
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 400px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) 120px;
  column-gap: 90px;
  row-gap: 24px;
}
.lyrics-workspace .lyric-art {
  align-self: center;
  min-width: 0;
}
.lyrics-workspace .large-cover {
  width: min(100%, 320px, 36dvh);
  margin-bottom: 22px;
}
.lyrics-workspace .lyric-art h1 {
  font-size: 26px;
  overflow-wrap: anywhere;
}
.lyrics-workspace .lyric-art p {
  margin-top: 8px;
}
.lyric-transport {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
}
.lyric-transport > :deep(.el-button) {
  flex-shrink: 0;
}
.lyric-transport > .play-button.el-button {
  width: 48px;
  height: 48px;
}
.lyric-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--day-muted, #829d8c);
  margin-top: 14px;
  font-variant-numeric: tabular-nums;
}
.lyric-progress :deep(.el-slider) {
  flex: 1;
  min-width: 0;
}
.lyrics-column {
  position: relative;
  min-width: 0;
  min-height: 0;
}
.lyrics-workspace .lyric-scroll {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: min(24dvh, 180px) 12px;
  gap: 10px;
}
.lyrics-workspace .follow-lyrics {
  right: 20px;
  bottom: 0;
}
.lyric-spectrum {
  grid-column: 1 / -1;
  display: block;
  width: 100%;
  height: 90px;
  pointer-events: none;
}
:global(html.android .lyrics-dialog.el-dialog) {
  background: var(--android-header-background);
}
:global(html.android .lyrics-dialog .lyrics-overlay) {
  background: var(--android-lyrics-edge);
}
:global(.lyrics-dialog .close-lyrics) {
  position: absolute;
  right: 24px;
  top: 18px;
  z-index: 1;
}
@media (max-width: 700px) {
  :global(.lyrics-dialog .lyrics-overlay) {
    padding: calc(22px + env(safe-area-inset-top, 0px)) 14px
      calc(8px + env(safe-area-inset-bottom, 0px));
  }
  :global(.lyrics-dialog .close-lyrics) {
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: 12px;
    width: 40px;
    height: 40px;
  }
  .lyrics-workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "info"
      "lyrics"
      "timeline"
      "transport";
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    gap: 6px;
  }
  .lyrics-workspace .lyric-art {
    display: contents;
  }
  .lyric-info {
    grid-area: info;
    min-width: 0;
    text-align: center;
  }
  .lyrics-workspace .large-cover {
    width: min(15dvh, 96px);
    margin: 12px auto 12px;
    border-radius: 50%;
  }
  .lyrics-workspace .lyric-art h1 {
    font-size: 19px;
  }
  .lyrics-workspace .lyric-art p {
    margin-top: 3px;
    font-size: 13px;
  }
  .lyric-info :is(h1, p) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lyrics-column {
    grid-area: lyrics;
  }
  .lyrics-workspace .lyric-scroll {
    padding-block: 12px;
    gap: 2px;
  }
  .lyrics-workspace .lyric-scroll :deep(.el-button) {
    justify-content: center;
    text-align: center;
  }
  .lyric-transport {
    grid-area: transport;
    justify-content: space-evenly;
    gap: 4px;
    margin: 0;
  }
  .lyric-transport > .icon-button.el-button {
    width: 42px;
    height: 44px;
    padding: 0;
  }
  .lyric-transport > .play-button.el-button {
    width: 52px;
    height: 52px;
  }
}

.lyric-volume {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 240px;
  margin-top: 10px;
  color: var(--day-muted, #829d8c);
}
.lyric-volume > svg {
  flex-shrink: 0;
}
.lyric-volume :deep(.el-slider) {
  flex: 1;
  min-width: 0;
}
.lyric-volume > span {
  min-width: 34px;
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.lyrics-workspace .lyric-scroll :deep(.el-button) {
  padding-block: 6px;
  line-height: 1.6;
}
@media (max-width: 700px) {
  .lyric-volume {
    max-width: 240px;
    margin: 4px auto 0;
  }
  .lyrics-workspace .lyric-scroll :deep(.el-button) {
    padding-block: 4px;
  }
}
.lyric-transport .lyric-volume {
  width: 90px;
  max-width: 90px;
  flex: 0 0 90px;
  gap: 8px;
  margin: 0 0 0 4px;
}
@media (max-width: 700px) {
  .lyric-transport .lyric-volume {
    display: none;
  }
}
.lyric-timeline {
  grid-column: 1 / -1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.lyric-timeline .lyric-spectrum {
  width: 100%;
  height: 90px;
  flex: 0 0 90px;
}
.lyric-timeline .lyric-progress {
  margin: 0;
  flex: 1;
}
@media (max-width: 700px) {
  .lyric-timeline {
    grid-area: timeline;
  }
  .lyric-timeline .lyric-spectrum {
    align-self: center;
    width: calc(100% + 28px);
    height: clamp(32px, 7.5dvh, 48px);
    flex: none;
  }
  .lyric-timeline .lyric-progress {
    flex: none;
    min-height: 30px;
  }
}
.now-title strong {
  font-size: 15px;
}
.now-title small {
  font-size: 13px;
  color: var(--day-muted, #a2b3a8);
}

.player .now-title small,
.player .progress,
.player .player-right,
.player .icon-button.el-button {
  color: var(--day-text, rgb(245 249 255 / 78%));
}
.player .icon-button.el-button:hover {
  color: var(--day-text, #fff);
  background: var(--day-selected, rgb(255 255 255 / 14%));
}
.player :deep(.el-slider__runway) {
  background: var(--day-scrollbar, rgb(255 255 255 / 22%));
}
.player :deep(.el-slider__bar),
.player :deep(.el-slider__button) {
  background: var(--day-accent-text, #f6f7f9);
}

@media (min-width: 701px) {
  .app-shell > .player {
    inset: auto 0 var(--desktop-player-bottom) var(--sidebar-width);
    width: min(900px, calc(100% - var(--sidebar-width) - 80px));
    margin-inline: auto;
    border-radius: 45px;
  }
}

@media (max-width: 700px) {
  .app-shell > .player {
    inset: auto 0 max(0px, env(safe-area-inset-bottom, 0px));
    border-radius: 0;
    width: auto;
    margin: 0;
  }
}
@media (max-width: 700px) {
  :global(html.android .app-shell > .player) {
    bottom: 0;
    height: calc(var(--mobile-player-bar-height) + env(safe-area-inset-bottom, 0px));
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    border: 0;
    background: var(--android-player-background);
    box-shadow: 0 -4px 20px rgb(0 0 0 / 12%);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  :global(html.android .player .audio-spectrum) {
    bottom: calc(4px + env(safe-area-inset-bottom, 0px));
  }

  :global(html.android .player::after) {
    inset: 0;
  }
}
</style>
