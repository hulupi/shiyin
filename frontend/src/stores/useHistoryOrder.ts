import { ref, watch, type Ref } from "vue";

// Keep the visible history stable until the user opens the page again.
export function useHistoryOrder(history: Ref<string[]>, active: Ref<boolean>) {
  const visibleIds = ref<string[]>([]);
  watch(
    [history, active],
    ([ids, isActive], previous) => {
      if (!isActive) return;
      const previousIds = visibleIds.value;
      const available = new Set(ids);
      const existing = new Set(previousIds);
      const next = previous?.[1]
        ? [
            ...previousIds.filter((id) => available.has(id)),
            ...ids.filter((id) => !existing.has(id)),
          ]
        : [...ids];
      if (
        next.length !== previousIds.length ||
        next.some((id, index) => id !== previousIds[index])
      ) {
        visibleIds.value = next;
      }
    },
    { immediate: true, flush: "sync" },
  );
  return visibleIds;
}
