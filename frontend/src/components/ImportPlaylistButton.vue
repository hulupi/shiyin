<script setup lang="ts">
import { ref } from "vue";
import type { Track } from "../../../backend/src/contracts";
import { requestApi } from "../services/api";
import { notify, reportError } from "../services/feedback";

const props = defineProps<{
  name: string;
  tracks?: Track[];
  source?: { platform: string; id: string };
}>();
const importing = ref(false);

async function importPlaylist() {
  if (importing.value) return;
  importing.value = true;
  try {
    const result = await requestApi("/playlists/import", {
      method: "POST",
      body: JSON.stringify({
        name: props.name,
        source: props.source,
        trackIds: props.source ? undefined : props.tracks?.map(track => track.id),
      }),
    });
    notify(`已将 ${result.trackIds.length} 首歌曲加入歌单「${result.name}」`);
  } catch (error) {
    reportError(error);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <el-button :loading="importing" @click="importPlaylist">加入我的歌单</el-button>
</template>
