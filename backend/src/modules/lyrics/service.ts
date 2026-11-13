import { readFile } from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import { authorizedFile } from '../library/service.js';
import type { StoredTrack } from '../../db/store.js';
export async function lyrics(track: StoredTrack) {
  if (track.lyricPath) { try { const bytes = await readFile(await authorizedFile(track, true)); try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('gb18030').decode(bytes); } } catch { /* Try embedded lyrics. */ } }
  const metadata = await parseFile(await authorizedFile(track), { skipCovers: true });
  const embedded = metadata.common.lyrics || [];
  // ID3 SYLT format 2 stores milliseconds; format 1 stores MPEG frames
  // and cannot be treated as a wall-clock timestamp without frame mapping.
  const synced = embedded.find(item => item.timeStampFormat === 2 && item.syncText?.some(line => Number.isFinite(line.timestamp)));
  if (synced) {
    return synced.syncText.filter(line => typeof line.timestamp === 'number' && Number.isFinite(line.timestamp) && line.timestamp >= 0).map(line => {
      const milliseconds = Math.round(line.timestamp!);
      const minutes = Math.floor(milliseconds / 60000);
      const seconds = Math.floor(milliseconds / 1000) % 60;
      const fraction = milliseconds % 1000;
      return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}]${line.text.replace(/\r?\n/g, ' ')}`;
    }).join('\n');
  }
  return embedded.map(item => item.text || item.syncText?.map(line => line.text).join('\n') || '').join('\n');
}
