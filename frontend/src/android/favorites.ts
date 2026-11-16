import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { read } from "./storage";

const favorites = registerPlugin<{
  getFavorites(options: { initial: string[] }): Promise<{ ids: string[] }>;
  updateFavorites(options: { toggleId?: string; removeIds?: string[] }): Promise<{ ids: string[] }>;
  addListener(event: "changed", listener: (state: { ids: string[] }) => void): Promise<PluginListenerHandle>;
}>("ShiyinFavorites");

export async function getAndroidFavorites() {
  return (await favorites.getFavorites({ initial: read<string[]>("favorites", []) })).ids;
}

export async function changeAndroidFavorites(options: { toggleId?: string; removeIds?: string[] }) {
  await getAndroidFavorites();
  return (await favorites.updateFavorites(options)).ids;
}

export const onAndroidFavoritesChanged = (listener: (state: { ids: string[] }) => void) =>
  favorites.addListener("changed", listener);
