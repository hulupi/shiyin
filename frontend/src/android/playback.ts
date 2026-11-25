import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface AndroidPlaybackItem {
  id: string;
  trackId: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  artwork?: string;
}

export interface AndroidPlaybackState {
  id: string;
  trackId?: string;
  serviceQueue?: boolean;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  failed: boolean;
  position: number;
  duration: number;
}

export const androidPlayback = registerPlugin<{
  start(item: AndroidPlaybackItem & { position: number; volume: number }): Promise<void>;
  configureQueue(options: { tracks: unknown[]; sources: unknown[]; quality: string; mode: string; nextId?: string }): Promise<void>;
  clearUpcoming(options: { currentId: string }): Promise<{ applied: boolean }>;
  append(options: { afterId: string } & AndroidPlaybackItem): Promise<{ applied: boolean }>;
  control(options: { action: "play" | "pause" | "next" | "seek" | "volume" | "repeat" | "state"; value?: number; enabled?: boolean }): Promise<AndroidPlaybackState>;
  addListener(event: "state", callback: (state: AndroidPlaybackState) => void): Promise<PluginListenerHandle>;
}>("ShiyinPlayback");
