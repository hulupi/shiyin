import type { Track } from "../../../backend/src/contracts";
import { requestApi } from "./api";

export async function loadPlaybackList(
  path: string, loaded: Track[], page: number, signal?: AbortSignal,
) {
  const tracks = new Map(loaded.map(track => [track.id, track]));
  let hasMore = true;
  while (hasMore) {
    signal?.throwIfAborted();
    const result: { tracks: Track[]; hasMore: boolean } =
      await requestApi(`${path}?page=${++page}`, { signal });
    for (const track of result.tracks) tracks.set(track.id, track);
    hasMore = result.hasMore;
  }
  signal?.throwIfAborted();
  return [...tracks.values()];
}
