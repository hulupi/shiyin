import { appUrl } from "./urls";
import type {
  AudioVariant,
  Track,
} from "../../../backend/src/contracts";
export const platformName = (id?: string) =>
  (
    ({ wy: "网易云", tx: "QQ", kw: "酷我", kg: "酷狗", mg: "咪咕" }) as Record<
      string,
      string
    >
  )[id || ""] || "本地";
export const qualityName = (quality?: string) =>
  (
    ({
      flac24bit: "Hi-Res",
      flac: "FLAC",
      "320k": "320K",
      "128k": "128K",
      local: "本地音频",
    }) as Record<string, string>
  )[quality || ""] || "未知音质";
export function variantQualityName(variant?: AudioVariant) {
  if (variant?.quality !== "local") return qualityName(variant?.quality);
  const format = variant.format?.trim() || qualityName("local");
  return variant.bitrate && variant.bitrate > 0
    ? `${variant.bitrate}kbps`
    : format;
}
export function fileSize(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes)) return "大小未知";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(unit ? 2 : 0)} ${units[unit]}`;
}
export function preferredVariant(track: Track): AudioVariant | undefined {
  return (
    track.audioVariants?.at(-1) ||
    (!track.online
      ? {
          quality: track.format === "FLAC" ? "flac" : "local",
          format: track.format,
          size: track.size,
        }
      : undefined)
  );
}
export const trackCover = (track: Track) =>
  appUrl(`/api/${track.online ? "online" : "tracks"}/${encodeURIComponent(track.id)}/cover`);
