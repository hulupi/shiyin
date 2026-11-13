<script setup lang="ts">
withDefaults(
  defineProps<{
    page: number;
    pageSize: number;
    total: number;
    disabled?: boolean;
    compact?: boolean;
  }>(),
  { disabled: false, compact: false },
);
defineEmits<{
  "update:page": [value: number];
  "update:pageSize": [value: number];
}>();
</script>
<template>
  <div v-if="total" class="list-pagination">
    <el-pagination
      background
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      :page-sizes="[50, 100, 200]"
      :disabled="disabled"
      :pager-count="5"
      :layout="
        compact
          ? 'prev, pager, next'
          : 'total, sizes, prev, pager, next, jumper'
      "
      @current-change="$emit('update:page', $event)"
      @size-change="$emit('update:pageSize', $event)"
    />
  </div>
</template>

<style scoped lang="scss">
.list-pagination {
  padding-top: 14px;
}
.list-pagination {
  display: flex;
  justify-content: flex-end;
  padding: 22px 0 8px;
  overflow-x: auto;
}
.list-pagination :deep(.el-pagination) {
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
@media (max-width: 700px) {
  .list-pagination :deep(.el-pagination__sizes),
  .list-pagination :deep(.el-pagination__jump) {
    display: none;
  }
}
</style>
