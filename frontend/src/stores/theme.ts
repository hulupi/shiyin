import { ref, watch } from "vue";

type Theme = "light" | "dark";
const storageKey = "shiyin:theme";

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
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", value === "light" ? "#f5f8f5" : "#101311");
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // The theme can still be changed for this session.
  }
}, { immediate: true, flush: "sync" });
