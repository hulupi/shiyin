import { shallowRef } from "vue";
import { requestApi } from "../services/api";

export interface PlaybackDownloadSettings {
  autoDownloadPlayback: boolean;
  playbackDownloadPercent: number;
}

export const playbackDownloadSettings = shallowRef<PlaybackDownloadSettings>();

export async function loadPlaybackDownloadSettings() {
  const previous = playbackDownloadSettings.value;
  const settings: PlaybackDownloadSettings = await requestApi("/downloads/settings");
  if (playbackDownloadSettings.value === previous) playbackDownloadSettings.value = settings;
}
