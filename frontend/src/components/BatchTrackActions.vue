<script setup lang="ts">
import { isAndroidOnline } from "../services/platform";
import { ref } from "vue";
import { ElMessage } from "element-plus";
import type { Track } from "../../../backend/src/contracts";
import { requestApi as api } from "../services/api";
import { reportError } from "../services/feedback";
import { confirmAction } from "../services/dialog";
import { library } from "../stores/library";

const props = defineProps<{tracks: Track[]; removeFavorites?: boolean; wholeAlbum?: boolean; removeFromPlaylist?: (ids: string[]) => Promise<boolean>}>();
const emit = defineEmits<{done: []}>();
const busy = ref(false), choosing = ref(false), playlistId = ref("");
const playlists = ref<{id:string;name:string}[]>([]);
async function run(work:()=>Promise<void>){
  if(busy.value || !props.tracks.length)return;
  busy.value=true;
  try { await work(); } catch(error){reportError(error);}
  finally {busy.value=false;}
}
const ids = () => props.tracks.map(track=>track.id);
async function batches(send:(trackIds:string[])=>Promise<any>, trackIds=ids()){
  const results=[];
  for(let index=0;index<trackIds.length;index+=200)results.push(await send(trackIds.slice(index,index+200)));
  return results;
}
const post=(url:string,trackIds:string[])=>api(url,{method:"POST",body:JSON.stringify({trackIds})});
function download(){
  return run(async()=>{
    if(!(await confirmAction("将按下载设置加入队列，跳过已有或正在下载的歌曲。","确认批量下载")))return;
    const results=await batches(chunk=>post("/downloads/batch",chunk));
    const sum=(key:string)=>results.reduce((total,item)=>total+item[key],0);
    const failure=results.find(item=>item.firstError)?.firstError;
    ElMessage({type:failure?"warning":"success",message:"已入队 "+sum("queued")+" 首，跳过 "+sum("skipped")+" 首，失败 "+sum("failed")+" 首"+(failure?"："+failure:"")});
    emit("done");
  });
}
function choose(){
  return run(async()=>{
    playlists.value=await api("/playlists");
    if(!playlists.value.length){ElMessage.info("请先在「我的歌单」新建歌单");return;}
    playlistId.value=playlists.value[0].id;
    choosing.value=true;
  });
}
function add(){
  return run(async()=>{
    await batches(chunk=>post("/playlists/"+encodeURIComponent(playlistId.value)+"/tracks",chunk));
    choosing.value=false;
    ElMessage.success("已加入歌单");
    emit("done");
  });
}
function removePlaylistTracks() {
  return run(async () => {
    if (await props.removeFromPlaylist?.(ids())) emit("done");
  });
}
function remove(){
  return run(async()=>{
    if(!(await confirmAction("确定移除选中的收藏？本地文件会保留。","批量取消收藏")))return;
    await batches(async chunk=>{library.value.favorites=await post("/favorites/remove-batch",chunk);});
    ElMessage.success("已移除选中的收藏");
    emit("done");
  });
}
</script>

<template>
  <div class="batch-track-actions">
    <el-button :disabled="busy || !tracks.length" v-if="!isAndroidOnline" @click="download">{{ wholeAlbum ? "下载整张专辑" : "批量下载" }}</el-button>
    <el-button v-if="removeFromPlaylist" :disabled="busy || !tracks.length" @click="removePlaylistTracks">从歌单移除</el-button>
    <el-button v-else :disabled="busy || !tracks.length" @click="choose">加入歌单</el-button>
    <el-button v-if="removeFavorites" :disabled="busy || !tracks.length" @click="remove">取消收藏</el-button>
    <el-dialog v-model="choosing" title="加入歌单" width="min(420px, 92vw)" append-to-body>
      <el-select v-model="playlistId" aria-label="选择歌单">
        <el-option v-for="item in playlists" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <template #footer>
        <div class="batch-dialog-footer">
          <el-button @click="choosing = false">取消</el-button>
          <el-button type="primary" :loading="busy" :disabled="!playlistId" @click="add">加入</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.batch-track-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.batch-track-actions > .el-button { margin: 0; }
.batch-dialog-footer { display: flex; justify-content: flex-end; gap: 8px; }
.batch-dialog-footer > .el-button { margin: 0; }
</style>
