import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface AndroidPlaybackItem {
  id: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  artwork?: string;
}

export interface AndroidPlaybackState {
  id: string;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  failed: boolean;
  position: number;
  duration: number;
}

export const androidPlayback = registerPlugin<{
  start(item: AndroidPlaybackItem & { position: number; volume: number }): Promise<void>;
  setNext(options: { currentId: string } & Partial<AndroidPlaybackItem>): Promise<void>;
  control(options: { action: "play" | "pause" | "next" | "seek" | "volume" | "repeat" | "state"; value?: number; enabled?: boolean }): Promise<AndroidPlaybackState>;
  addListener(event: "state", callback: (state: AndroidPlaybackState) => void): Promise<PluginListenerHandle>;
}>("ShiyinPlayback");
