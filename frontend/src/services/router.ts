import { computed, ref } from "vue";

export const routeNames: Record<string, string> = {
  首页: "home",
  搜索: "search",
  榜单: "charts",
  发现歌单: "discover",
  本地音乐: "library",
  我的收藏: "favorites",
  我的歌单: "playlists",
  下载管理: "downloads",
  播放历史: "history",
  设置: "settings",
};
function readRoute() {
  const url = new URL(
    window.location.hash.slice(1) || "/library",
    window.location.origin,
  );
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const page =
    Object.keys(routeNames).find((key) => routeNames[key] === parts[0]) ||
    "本地音乐";
  return {
    page,
    platform: parts[1] || "wy",
    id: (page === "我的歌单" ? parts[1] : parts[2]) || "",
    query: Object.fromEntries(url.searchParams),
  };
}
export const route = ref(readRoute());
const rememberedPages = new Set(["榜单", "发现歌单", "我的歌单"]);
const lastRoutes = new Map<string, ReturnType<typeof readRoute>>();

function syncRoute() {
  const next = readRoute();
  if (rememberedPages.has(next.page)) lastRoutes.set(next.page, next);
  route.value = next;
}

syncRoute();
export function navigate(
  page: string,
  platform = "wy",
  id = "",
  query: Record<string, string> = {},
  replace = false,
) {
  const path = routeNames[page] || "library";
  const detail = ["榜单", "发现歌单"].includes(page)
    ? "/" +
      encodeURIComponent(platform) +
      (id ? "/" + encodeURIComponent(id) : "")
    : page === "我的歌单" && id
      ? "/" + encodeURIComponent(id)
      : "";
  const search = new URLSearchParams(query).toString();
  const hash = "#/" + path + detail + (search ? "?" + search : "");
  if (window.location.hash === hash) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", hash);
  syncRoute();
}
window.addEventListener("hashchange", syncRoute);
window.addEventListener("popstate", syncRoute);
if (!window.location.hash) navigate("本地音乐", "wy", "", {}, true);
export const currentPage = computed({
  get: () => route.value.page,
  set: (page: string) => {
    const last = lastRoutes.get(page);
    if (last) navigate(page, last.platform, last.id, last.query);
    else navigate(page);
  },
});
