import type { Track } from '../../../backend/src/contracts';

const prefix = 'shiyin.android.';
export function read<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(prefix + key);
  return value == null ? fallback : JSON.parse(value) as T;
}

export function write(key: string, value: unknown) {
  localStorage.setItem(prefix + key, JSON.stringify(value));
}

export function loadRecords<T>(key: string) {
  return read<T[]>(key, []);
}

export function upsertRecord<T extends { id: string }>(key: string, entry: T) {
  write(key, [...loadRecords<T>(key).filter(item => item.id !== entry.id), entry]);
}

// The catalog adapters share these data interfaces with the server build.
export const searchLocalRecords = <T>(): T[] => [];
export const state = { tracks: [] as Track[] };
export const publicTrack = (track: Track) => track;
