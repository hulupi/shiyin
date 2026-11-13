import { onMounted, onUnmounted } from "vue";

// Mobile pages scroll as a whole; desktop lists keep their own viewport.
export function nearScrollEnd(element: HTMLElement, threshold = 240) {
  if (window.matchMedia("(max-width: 700px)").matches) {
    const page = element.closest<HTMLElement>(".route-page");
    if (page) return element.getBoundingClientRect().bottom - page.getBoundingClientRect().bottom < threshold;
  }
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

export function usePageScroll(element: () => HTMLElement | undefined, load: () => void) {
  let page: HTMLElement | null | undefined;
  const onScroll = () => {
    if (window.matchMedia("(max-width: 700px)").matches) load();
  };
  onMounted(() => {
    page = element()?.closest<HTMLElement>(".route-page");
    page?.addEventListener("scroll", onScroll, { passive: true });
  });
  onUnmounted(() => page?.removeEventListener("scroll", onScroll));
}
