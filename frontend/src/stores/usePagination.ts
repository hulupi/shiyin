import { computed, ref, watch, type Ref } from "vue";
export function usePagination<T>(items: Ref<T[]>) {
  const currentPage = ref(1),
    pageSize = ref(50);
  const total = computed(() => items.value.length);
  const offset = computed(() => (currentPage.value - 1) * pageSize.value);
  const pagedItems = computed(() =>
    items.value.slice(offset.value, offset.value + pageSize.value),
  );
  watch([total, pageSize], () => {
    currentPage.value = Math.min(
      currentPage.value,
      Math.max(1, Math.ceil(total.value / pageSize.value)),
    );
  });
  function resize(size: number) {
    pageSize.value = size;
    currentPage.value = 1;
  }
  return { currentPage, pageSize, total, offset, pagedItems, resize };
}
