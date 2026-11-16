import { registerPlugin } from "@capacitor/core";
import { ref, watch } from "vue";
import { isAndroidOnline } from "../services/platform";

type Theme = "light" | "dark";
const storageKey = "shiyin:theme";

const systemBars = registerPlugin<{
  setAppearance(options: { status: string; navigation: string; darkIcons: boolean }): Promise<void>;
}>("ShiyinSystemBars");

function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export const theme = ref<Theme>(readTheme());

watch(theme, (value) => {
  const html = document.documentElement;
  html.classList.toggle("dark", value === "dark");
  html.classList.toggle("light", value === "light");
  const color = value === "light" ? "#f5f8f5" : "#101311";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // The theme can still be changed for this session.
  }
}, { immediate: true, flush: "sync" });

const lyricsOpen = ref(false);

export function setLyricsSystemBars(open: boolean) {
  if (isAndroidOnline) lyricsOpen.value = open;
}

if (isAndroidOnline) {
  watch([theme, lyricsOpen], ([value, open]) => {
    const light = value === "light";
    const header = light ? "#ffffff" : "#101713";
    const player = light ? "#eff5ef" : "#161e19";
    const lyrics = light ? "#eff5ef" : "#101a14";
    const html = document.documentElement;
    html.style.setProperty("--android-header-background", header);
    html.style.setProperty("--android-player-background", player);
    html.style.setProperty("--android-lyrics-edge", lyrics);

    void systemBars.setAppearance({
      status: open ? lyrics : header,
      navigation: open ? lyrics : player,
      darkIcons: light,
    })
      .catch(error => console.warn("Unable to update Android system bars", error));
  }, { immediate: true, flush: "sync" });
}
