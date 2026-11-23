import type { IAudioMetadata } from 'music-metadata';

// Validate the downloaded file before tagging, saving, or binding it locally.
export function validateDownload(metadata: IAudioMetadata, expectedDuration: number) {
  const duration = metadata.format.duration;
  if (!metadata.format.codec || !Number.isFinite(duration) || !duration || duration <= 0)
    throw new Error('无法确认下载音频的完整时长，已拒绝保存');
  if (Number.isFinite(expectedDuration) && expectedDuration > 0) {
    const tolerance = Math.max(3, Math.min(10, expectedDuration * 0.03));
    if (duration < expectedDuration - tolerance)
      throw new Error(`音源返回的音频不完整或为试听片段（${Math.round(duration)} 秒，歌曲约 ${Math.round(expectedDuration)} 秒）`);
  }
}
