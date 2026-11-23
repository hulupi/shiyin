import { randomUUID } from 'node:crypto';
import { loadSetting, saveSetting } from '../../db/database.js';

type Operation = 'playback' | 'download' | 'exception';
type Stage = 'plan' | 'request' | 'response' | 'audio-url' | 'download' | 'skipped' | 'attempt' | 'switch' | 'resolved' | 'source-failed' | 'playing' | 'completed' | 'failed' | 'cancelled';
interface SourceDetails {
  requestUrl?: string;
  audioUrl?: string;
  downloadUrl?: string;
  method?: string;
  statusCode?: number;
  sourcePosition?: number;
  message?: string;
  source?: string;
  quality?: string;
  format?: string;
  bitrate?: number;
  fromSource?: string;
  fromQuality?: string;
  reason?: 'timeout' | 'unavailable' | 'playback' | 'transfer';
}
interface Activity extends SourceDetails {
  id: string;
  operationId: string;
  operation: Operation;
  stage: Stage;
  time: string;
  trackId: string;
  title: string;
  artist: string;
  requestedQuality: string;
}
type ActivityTrack = { id: string; title: string; artist: string };
const setting = 'source-activity';
const events = loadSetting<Activity[]>(setting, []);
const limit = 500;

export function listSourceActivity() {
  return events;
}

export function reloadSourceActivity() {
  events.splice(0, events.length, ...loadSetting<Activity[]>(setting, []));
}

export function clearSourceActivity() {
  saveSetting(setting, []);
  events.length = 0;
}

export function sourceActivity(operation: Operation, track: ActivityTrack, requestedQuality: string, previousId?: unknown) {
  const previous = typeof previousId === 'string' ? events.find(event =>
    event.operationId === previousId && event.operation === operation && event.trackId === track.id) : undefined;
  const operationId = previous?.operationId ?? randomUUID();
  let lastSource = events.find(event =>
    event.operationId === operationId && (event.stage === 'attempt' || event.stage === 'resolved'));
  function record(stage: Stage, details: SourceDetails = {}) {
    const event: Activity = {
      id: randomUUID(), operationId, operation, stage, time: new Date().toISOString(),
      trackId: track.id, title: track.title.slice(0, 200), artist: track.artist.slice(0, 200),
      requestedQuality: previous?.requestedQuality ?? requestedQuality,
      ...details,
      message: details.message?.slice(0, 2000),
      requestUrl: details.requestUrl?.slice(0, 8192),
      audioUrl: details.audioUrl?.slice(0, 8192),
      downloadUrl: details.downloadUrl?.slice(0, 8192),
    };
    events.unshift(event);
    if (events.length > limit) events.length = limit;
    try { saveSetting(setting, events); }
    catch { console.error('无法保存音源日志'); }
    return event;
  }
  return {
    id: operationId,
    record,
    attempt(source: string, quality: string, sourcePosition?: number) {
      if (lastSource && (lastSource.source !== source || lastSource.quality !== quality)) {
        record('switch', { fromSource: lastSource.source, fromQuality: lastSource.quality, source, quality });
      }
      lastSource = record('attempt', { source, quality, sourcePosition });
    },
  };
}

export function recordActivityException(title: string, message: string) {
  sourceActivity('exception', { id: '', title, artist: '' }, '').record('failed', { message });
}

export type SourceActivity = ReturnType<typeof sourceActivity>;

export function recordPlaybackOutcome(track: ActivityTrack, id: unknown, stage: 'playing' | 'source-failed') {
  if (typeof id !== 'string') return;
  const latest = events.find(event => event.operationId === id && event.operation === 'playback' && event.trackId === track.id);
  if (latest?.stage !== 'resolved' && !(stage === 'source-failed' && latest?.stage === 'playing')) return;
  sourceActivity('playback', track, latest.requestedQuality, id).record(stage, {
    source: latest.source, quality: latest.quality,
    reason: stage === 'source-failed' ? 'playback' : undefined,
  });
}
