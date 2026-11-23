import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IAudioMetadata } from 'music-metadata';
import { validateDownload } from './validate.js';
const audio = (duration?: number, codec = 'AAC'): IAudioMetadata => ({
  format: { duration, codec, trackInfo: [], tagTypes: [] }, native: {}, common: { track: { no: null, of: null }, disk: { no: null, of: null }, movementIndex: { no: null, of: null } }, quality: { warnings: [] },
});
test('accepts complete M4A, MP3 and FLAC', () => {
  for (const codec of ['AAC', 'MPEG 1 Layer 3', 'FLAC']) assert.doesNotThrow(() => validateDownload(audio(240, codec), 240));
});
test('rejects a few seconds and preview clips', () => {
  for (const duration of [3, 10, 30, 90, 200]) assert.throws(() => validateDownload(audio(duration), 240), /不完整或为试听片段/);
});
test('allows small duration differences and real short tracks', () => {
  assert.doesNotThrow(() => validateDownload(audio(237), 240));
  assert.doesNotThrow(() => validateDownload(audio(5), 5));
});
test('rejects missing, invalid duration or missing codec', () => {
  for (const duration of [undefined, 0, -1, NaN, Infinity]) assert.throws(() => validateDownload(audio(duration), 240));
  assert.throws(() => validateDownload(audio(240, ''), 240));
});
test('unknown catalog duration still requires readable audio duration', () => {
  assert.doesNotThrow(() => validateDownload(audio(240), 0));
  assert.throws(() => validateDownload(audio(), 0));
});
