interface MediaTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
}
interface Controls {
  play(): void;
  pause(): void;
  previous(): void;
  next(): void;
  stop(): void;
  seek(position: number): void;
  position(): number;
}
interface Platform {
  session?: MediaSession;
  Metadata?: typeof MediaMetadata;
  origin: string;
}
/** Optional OS integration: unsupported WebViews must retain normal playback. */
export function connectSystemMediaSession(controls: Controls, platform: Platform = {
  session: navigator.mediaSession,
  Metadata: window.MediaMetadata,
  origin: window.location.origin,
}) {
  const { session, Metadata, origin } = platform;
  const registered: MediaSessionAction[] = [];
  let metadataKey = '';
  let disposed = false;
  const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => controls.play(),
    pause: () => controls.pause(),
    previoustrack: () => controls.previous(),
    nexttrack: () => controls.next(),
    stop: () => controls.stop(),
    seekto: details => { if (Number.isFinite(details.seekTime)) controls.seek(details.seekTime!); },
    seekbackward: details => controls.seek(controls.position() - (details.seekOffset ?? 10)),
    seekforward: details => controls.seek(controls.position() + (details.seekOffset ?? 10)),
  };
  for (const [action, handler] of Object.entries(actions)) {
    try {
      session?.setActionHandler(action as MediaSessionAction, handler!);
      if (session) registered.push(action as MediaSessionAction);
    } catch { /* Actions vary across Android/iOS and embedded browsers. */ }
  }
  return {
    update(track: MediaTrack | null, playing: boolean, duration: number, position: number, rate = 1) {
      if (!session || disposed) return;
      const key = JSON.stringify(track);
      if (key !== metadataKey) {
        try {
          session.metadata = track && Metadata ? new Metadata({
            title: track.title,
            artist: track.artist,
            album: track.album || '',
            artwork: track.artwork ? [{ src: new URL(track.artwork, origin).href }] : [],
          }) : null;
          metadataKey = key;
        } catch { /* Metadata is optional and must not interrupt audio. */ }
      }
      try { session.playbackState = track ? (playing ? 'playing' : 'paused') : 'none'; } catch { /* Optional. */ }
      try {
        if (track && Number.isFinite(duration) && duration > 0) {
          session.setPositionState({
            duration,
            position: Math.max(0, Math.min(duration, Number.isFinite(position) ? position : 0)),
            playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
          });
        } else session.setPositionState({});
      } catch { /* Position state is not supported by every WebView. */ }
    },
    dispose() {
      disposed = true;
      for (const action of registered) {
        try { session?.setActionHandler(action, null); } catch { /* Optional. */ }
      }
      if (!session) return;
      try { session.metadata = null; } catch { /* Optional. */ }
      try { session.playbackState = 'none'; } catch { /* Optional. */ }
      try { session.setPositionState({}); } catch { /* Optional. */ }
    },
  };
}
