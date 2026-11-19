import type { Track } from '../../../backend/src/contracts';

const prefix = 'shiyin.android.';
export function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(prefix + key);
    if (value == null) return fallback;
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== typeof fallback
      || Array.isArray(parsed) !== Array.isArray(fallback)) return fallback;
    return parsed as T;
  } catch (error) {
    console.warn("Unable to read Android storage", key, error);
    return fallback;
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'QuotaExceededError'
      ? '本地存储空间不足，保存失败'
      : '无法保存到本地存储';
    console.warn("Unable to write Android storage", key, error);
    throw new Error(message);
  }
}

export function loadRecords<T>(key: string) {
  return read<T[]>(key, []).filter(record => record !== null && typeof record === "object");
}

export function upsertRecord<T extends { id: string }>(key: string, entry: T) {
  write(key, [...loadRecords<T>(key).filter(item => item.id !== entry.id), entry]);
}

// The catalog adapters share these data interfaces with the server build.
export const searchLocalRecords = <T>(): T[] => [];
export const state = { tracks: [] as Track[] };
export const publicTrack = (track: Track) => track;
