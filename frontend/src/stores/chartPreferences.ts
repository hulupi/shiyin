import { shallowRef } from "vue";
import { requestApi } from "../services/api";
import { navigate } from "../services/router";

export const chartPlatforms = [
  { id: "wy", name: "网易云音乐" },
  { id: "tx", name: "QQ 音乐" },
  { id: "kw", name: "酷我音乐" },
  { id: "kg", name: "酷狗音乐" },
  { id: "mg", name: "咪咕音乐" },
];

export interface Chart {
  id: string;
  name: string;
  image: string;
  description: string;
  update: string;
  count: number;
  group: string;
}

const directoryCache = new Map<string, { charts: Chart[]; expiresAt: number }>();
const latestRequest = new Map<string, symbol>();
const directoryCacheMs = 60_000;

export async function fetchCharts(
  platform: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<Chart[]> {
  options.signal?.throwIfAborted();
  const cached = directoryCache.get(platform);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.charts;

  const request = Symbol();
  latestRequest.set(platform, request);
  const data = await requestApi(
    `/charts/${platform}${options.refresh ? "?refresh=1" : ""}`,
    { signal: options.signal },
  );
  if (latestRequest.get(platform) === request) {
    directoryCache.set(platform, { charts: data.charts, expiresAt: Date.now() + directoryCacheMs });
  }
  return data.charts;
}

export function navigateToChart(platform: string, chart: Chart) {
  navigate("榜单", platform, chart.id, { name: chart.name, update: chart.update });
}

type Preference = "visible" | "recommended";
type Preferences = Record<string, Partial<Record<Preference, boolean>>>;
const storageKey = "shiyin:chart-preferences";

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

const preferences = shallowRef(readPreferences());

function chartKey(platform: string, id: string) {
  return `${platform}:${id}`;
}

export function chartPreference(platform: string, id: string, option: Preference) {
  const saved = preferences.value[chartKey(platform, id)]?.[option];
  return typeof saved === "boolean" ? saved : option === "visible";
}

export function hasRecommendedCharts(platform: string) {
  return Object.entries(preferences.value).some(
    ([key, preference]) =>
      key.startsWith(`${platform}:`) && preference?.recommended === true,
  );
}

export function setChartPreference(
  platform: string,
  ids: string[],
  option: Preference,
  enabled: boolean,
) {
  const updated = { ...preferences.value };
  for (const id of ids) {
    const key = chartKey(platform, id);
    updated[key] = { ...updated[key], [option]: enabled };
  }
  localStorage.setItem(storageKey, JSON.stringify(updated));
  preferences.value = updated;
}
