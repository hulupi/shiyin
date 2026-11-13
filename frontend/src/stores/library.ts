import { ElMessage } from "element-plus";
import { navigate } from "../services/router";
import { h, ref } from "vue";
import type {
  LibraryState,
  Track,
} from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import { reportError } from "../services/feedback";

// Shared library data is consumed by pages and the persistent player.
export const library = ref<LibraryState>({
  directories: [],
  tracks: [],
  favorites: [],
  history: [],
  scan: { running: false, scanned: 0, failed: 0, errors: [] },
});
export const preferredQuality = ref("320k");
export const playbackFallback = ref<Track[]>();
export const libraryLoading = ref(true);
export async function refreshLibrary() {
  try {
    library.value = await api("/library");
  } catch (error) {
    reportError(error);
  } finally {
    libraryLoading.value = false;
  }
}
export async function toggleFavorite(track: Track) {
  try {
    const result = await api(
      "/favorites/" + encodeURIComponent(track.id) + "?feedback=1",
      { method: "POST" },
    );
    library.value.favorites = Array.isArray(result) ? result : result.favorites;
    if (result.download?.status === "queued") ElMessage.success("已收藏，并加入下载队列");
    else if (result.download?.status === "error") ElMessage.warning({
      duration: 6000,
      message: h("span", [
        "已收藏；自动下载未入队：" + result.download.message + " ",
        h("button", { type:"button", class:"text-button", onClick:()=>navigate("下载管理") }, "查看下载管理"),
      ]),
    });
    else if (library.value.favorites.includes(track.id)) ElMessage.success("收藏成功");
    if (track.online) await refreshLibrary();
  } catch (error) {
    reportError(error);
  }
}
export async function scanLibrary(cancel = false) {
  try {
    await api(cancel ? "/scan/cancel" : "/scan", { method: "POST" });
    await refreshLibrary();
  } catch (error) {
    reportError(error);
  }
}
