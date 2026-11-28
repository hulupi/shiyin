import { registerPlugin } from "@capacitor/core";
import { ref, watch } from "vue";
import { isAndroidOnline } from "../services/platform";

type Theme = "light" | "dark";
const storageKey = "shiyin:theme";

const systemBars = registerPlugin<{
  setAppearance(options: { status: string; navigation: string; darkIcons: boolean; drawerColor?: string; drawerWidth?: number }): Promise<void>;
}>("ShiyinSystemBars");

function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export const theme = ref<Theme>(readTheme());
export const mobileMenuOpen = ref(false);
export const mobileMenuCoverage = ref<{ width: number; fullWidth: number } | null>(null);

function dimSystemBar(color: string, progress: number) {
  return color.replace(/[0-9a-f]{2}/gi, channel =>
    Math.round(Number.parseInt(channel, 16) * (1 - 0.45 * progress)).toString(16).padStart(2, "0"),
  );
}

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

if (isAndroidOnline) {
  watch([theme, mobileMenuCoverage], ([value, coverage]) => {
    const light = value === "light";
    const header = light ? "#ffffff" : "#101713";
    const player = light ? "#eff5ef" : "#161e19";
    const lyrics = light ? "#eff5ef" : "#101a14";
    const html = document.documentElement;
    html.style.setProperty("--android-header-background", header);
    html.style.setProperty("--android-player-background", player);
    html.style.setProperty("--android-lyrics-edge", lyrics);

    const page = getComputedStyle(html).getPropertyValue("--el-bg-color-page").trim();
    const status = /^#[0-9a-f]{6}$/i.test(page) ? page : (light ? "#f3f6f2" : "#212924");
    const width = coverage?.width ?? 0;
    const progress = coverage ? width / coverage.fullWidth : 0;
    void systemBars.setAppearance({
      status: progress ? dimSystemBar(status, progress) : status,
      navigation: progress ? dimSystemBar(player, progress) : player,
      darkIcons: light,
      drawerWidth: width,
      drawerColor: width > 0
        ? getComputedStyle(html).getPropertyValue("--sidebar-surface").trim()
        : undefined,
    })
      .catch(error => console.warn("Unable to update Android system bars", error));
  }, { immediate: true, flush: "sync" });
}
