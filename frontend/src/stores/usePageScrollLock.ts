import { onUnmounted, watch, type Ref } from "vue";

/** Lock the document while leaving the overlay's own scroll container usable. */
export function usePageScrollLock(locked: Ref<boolean>) {
  let restore: (() => void) | undefined;
  watch(
    locked,
    (value) => {
      restore?.();
      restore = undefined;
      if (!value) return;
      const elements = [document.documentElement, document.body];
      const previous = elements.map((element) => ({
        element,
        overflow: element.style.overflow,
        overscrollBehavior: element.style.overscrollBehavior,
        scrollbarGutter: element.style.scrollbarGutter,
      }));
      const position = { left: window.scrollX, top: window.scrollY };
      for (const element of elements) {
        element.style.overflow = "hidden";
        element.style.overscrollBehavior = "none";
      }
      document.documentElement.style.scrollbarGutter = "auto";
      restore = () => {
        for (const entry of previous) {
          entry.element.style.overflow = entry.overflow;
          entry.element.style.overscrollBehavior = entry.overscrollBehavior;
          entry.element.style.scrollbarGutter = entry.scrollbarGutter;
        }
        window.scrollTo({ ...position, behavior: "instant" });
      };
    },
    { flush: "post", immediate: true },
  );
  onUnmounted(() => restore?.());
}
