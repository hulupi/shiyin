<script setup lang="ts">
import { useSlots } from "vue";
defineProps<{
  title: string;
  description: string;
  local?: boolean;
  floating?: boolean;
  settings?: boolean;
  directory?: boolean;
}>();
const slots = useSlots();
</script>
<template>
  <section class="route-page" :class="{ 'directory-layout': directory, 'settings-layout': settings }">
    <header v-if="!settings" class="topbar">
      <div class="topbar-heading">
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <div v-if="slots.actions" class="topbar-actions">
        <slot name="actions" />
      </div>
      
    </header>
    <div
      class="content"
      :class="{
        'local-content': local,
        'settings-content': settings,
        'floating-content': floating,
      }"
    >
      <slot />
    </div>
  </section>
</template>

<style scoped lang="scss">
.status-dot {
  display: inline-block;
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  background: var(--green);
  border-radius: 50%;
  box-shadow: 0 0 9px #44d17a25;
}

.topbar {
  height: 76px;
  border-bottom: 1px solid var(--day-line, #1d251f);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 38px;
}

.top-status {
  display: flex;
  gap: 9px;
  align-items: center;
  font-size: 13px;
  color: var(--day-muted, #89968e);
}

.avatar {
  display: grid;
  place-items: center;
  border: 1px solid var(--day-line, #344338);
  color: var(--day-text, #accbb5);
  background: var(--day-surface-soft, #1a2b20);
  border-radius: 50%;
  height: 30px;
  width: 30px;
  font-size: 12px;
  margin-left: 16px;
}

.content {
  max-width: 1700px;
  margin: auto;
  padding: 35px 38px;
}

@media (max-width: 1100px) {
  .content {
    padding: 28px 25px;
  }

  .topbar {
    padding: 0 25px;
  }
}

@media (max-width: 700px) {
  .topbar {
    height: 60px;
    padding: 0 17px;
  }

  .top-status {
    font-size: 0;
    gap: 0;
  }

  .top-status .status-dot {
    display: none;
  }

  .avatar {
    font-size: 12px;
    width: 27px;
    height: 27px;
  }

  .content {
    padding: 25px 16px;
  }
}

.topbar {
  flex-shrink: 0;
}

.content {
  flex: 1;
  width: 100%;
  max-width: none;
  min-width: 0;
  min-height: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content
  > :not(.song-table):not(.online-search):not(.downloads-page):not(
    .playlists-page
  ) {
  flex-shrink: 0;
}

@media (max-width: 700px) {
  .content {
    padding: 16px;
  }
}

.content > :deep(.empty-state) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.content > :deep(.collection-page) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.content {
  position: relative;
}

.content.page-switching > :not(.page-loading) {
  visibility: hidden;
}
.topbar {
  height: 64px;
  border: 0;
  padding-inline: 32px;
}
.content {
  padding: 20px 32px 8px;
}
@media (max-width: 700px) {
  .topbar {
    padding-inline: 16px;
    height: 54px;
  }
  .content {
    padding: 14px 14px 0;
  }
}
.content:is(.local-content, .floating-content) {
  padding-bottom: 0;
}
:is(.local-content, .floating-content) :deep(.song-table-rows) {
  padding-bottom: var(--list-bottom-padding);
}
.content:is(.local-content, .floating-content) {
  --list-right-inset: 32px;
  padding-right: 0;
}
:is(.local-content, .floating-content) :deep(.song-table > :is(.song-toolbar, .table-header)) {
  margin-right: var(--list-right-inset);
}
:is(.local-content, .floating-content) :deep(.song-table-rows) {
  padding-right: var(--list-right-inset);
}
@media (max-width: 700px) {
  .content:is(.local-content, .floating-content) {
    --list-right-inset: 14px;
  }
}
.content:has(> .charts-page) {
  padding-right: 0;
  padding-bottom: 0;
}
.topbar {
  height: 86px;
  gap: 20px;
}
.topbar-heading {
  min-width: 0;
  flex: 1;
}
.topbar-heading h1 {
  font-size: 24px;
  line-height: 1.35;
  letter-spacing: -0.5px;
}
.topbar-heading p {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.6;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.topbar-actions:empty {
  display: none;
}
.content {
  padding-top: 16px;
}
@media (max-width: 700px) {
  .topbar {
    height: 82px;
    gap: 10px;
  }
  .topbar-heading h1 {
    font-size: 21px;
  }
  .topbar-heading p {
    font-size: 12px;
  }
  .topbar .top-status {
    display: none;
  }
  .topbar-actions :deep(.secondary) {
    font-size: 12px;
    padding: 8px;
  }
  .content {
    padding-top: 12px;
  }
}
.route-page {
  --list-bottom-padding: 16px;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.directory-layout .content {
  padding-right: 0;
  padding-bottom: 0;
}

@media (max-width: 700px) {
  .route-page {
    --list-bottom-padding: 12px;
    display: block;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--day-scrollbar, #34513e) transparent;
    padding-bottom: var(--player-height);
  }
  .route-page .topbar { position: static; }
  .route-page .content {
    display: block;
    overflow: visible;
    height: auto;
    min-height: 0;
  }
  .content :deep(:is(.collection-page, .online-search, .charts-page, .downloads-page, .playlists-page, .song-table, .song-table-rows, .chart-directory, .playlist-directory)) {
    flex: none;
    height: auto;
    overflow: visible;
  }
  .content :deep(.download-table) {
    flex: none;
    height: auto !important;
  }
  .content :deep(.download-table .el-table__inner-wrapper) { height: auto; }
  .content :deep(.download-table .el-table__body-wrapper) { flex: none; }
  .content :deep(.download-table .el-scrollbar__wrap) { height: auto !important; max-height: none !important; }
}
.settings-layout .settings-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 12px;
}
@media (max-width: 700px) {
  .route-page.settings-layout {
    display: flex;
    overflow: hidden;
  }
}
</style>
