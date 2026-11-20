import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { state, publicTrack } from '../../db/store.js';
import { loadPlaylists, savePlaylists } from '../../db/database.js';
import { getOnlineTrack, saveOnlineTrack, publicOnlineTrack } from '../catalog/service.js';
import { collectDiscoverTracks } from '../catalog/discover.js';

interface Playlist {id:string;name:string;createdAt:string;trackIds:string[]}
const playlists:Playlist[]=loadPlaylists<Playlist>();
export function reloadPlaylists() {
  playlists.splice(0, playlists.length, ...loadPlaylists<Playlist>());
}
export async function removeDeletedTrack(id:string){for(const item of playlists)item.trackIds=item.trackIds.filter(value=>value!==id);await save();}
async function save(){savePlaylists(playlists);}
function publicSong(id:string){const local=state.tracks.find(track=>track.id===id);if(local)return publicTrack(local);try{return publicOnlineTrack(getOnlineTrack(id));}catch{return null;}}
export const playlistRouter=Router();
playlistRouter.get('/playlists',(_req,res)=>res.json(playlists.map(item=>({...item,count:item.trackIds.length}))));
playlistRouter.post('/playlists',async(req,res)=>{
  const name=typeof req.body.name==='string'?req.body.name.trim():'';if(!name||name.length>80)return res.status(400).json({error:'歌单名称需要为 1–80 字'});
  if(playlists.length>=100)return res.status(400).json({error:'最多支持 100 个歌单'});
  const entry={id:randomUUID(),name,createdAt:new Date().toISOString(),trackIds:[]};playlists.push(entry);await save();res.status(201).json(entry);
});
playlistRouter.post('/playlists/import', async (req, res) => {
  const { name: rawName, source, trackIds } = req.body ?? {};
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return res.status(400).json({ error: '歌单名称不能为空' });
  let ids: string[];
  let online;
  if (source) {
    online = await collectDiscoverTracks(source.platform, source.id);
    ids = online.map(track => track.id);
  } else {
    if (!Array.isArray(trackIds) || trackIds.length > 10000 || trackIds.some(id => typeof id !== 'string'))
      return res.status(400).json({ error: '请选择 1–10000 首歌曲' });
    ids = [...new Set<string>(trackIds)];
    const localIds = new Set(state.tracks.map(track => track.id));
    online = ids.filter(id => !localIds.has(id)).map(getOnlineTrack);
  }
  if (!ids.length) return res.status(400).json({ error: '歌单没有可导入的歌曲' });
  if (playlists.length >= 100) return res.status(400).json({ error: '最多支持 100 个歌单' });
  for (const track of online) await saveOnlineTrack(track);
  if (playlists.length >= 100) return res.status(400).json({ error: '最多支持 100 个歌单' });
  const entry = { id: randomUUID(), name, createdAt: new Date().toISOString(), trackIds: ids };
  savePlaylists([...playlists, entry]);
  playlists.push(entry);
  res.status(201).json(entry);
});
playlistRouter.patch('/playlists/:id', (req, res) => {
  const entry = playlists.find(item => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '歌单不存在' });
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 80) return res.status(400).json({ error: '歌单名称需要为 1–80 字' });
  const updated = { ...entry, name };
  savePlaylists(playlists.map(item => item === entry ? updated : item));
  entry.name = name;
  res.json(updated);
});
playlistRouter.get('/playlists/:id',(req,res)=>{const entry=playlists.find(item=>item.id===req.params.id);if(!entry)return res.status(404).json({error:'歌单不存在'});res.json({...entry,tracks:entry.trackIds.map(publicSong).filter(Boolean)});});
playlistRouter.post('/playlists/:id/tracks',async(req,res)=>{
  const entry=playlists.find(item=>item.id===req.params.id);if(!entry)return res.status(404).json({error:'歌单不存在'});
  const ids=req.body.trackIds??[req.body.trackId];
  if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'))throw new Error('请选择 1–200 首歌曲');
  const tracks=[...new Set<string>(ids)].filter(id=>!state.tracks.some(track=>track.id===id)).map(getOnlineTrack);
  for(const track of tracks)await saveOnlineTrack(track);
  const merged=[...new Set([...entry.trackIds,...ids])];
  if(merged.length>10000)throw new Error('歌单歌曲数已达上限');
  entry.trackIds=merged;await save();res.json(entry);
});
playlistRouter.post('/playlists/:id/tracks/remove-batch', (req, res) => {
  const entry = playlists.find(item => item.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '歌单不存在' });
  const ids = req.body?.trackIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string'))
    return res.status(400).json({ error: '请选择 1–200 首歌曲' });
  const selected = new Set(ids);
  const remaining = entry.trackIds.filter(id => !selected.has(id));
  savePlaylists(playlists.map(item => item === entry ? { ...item, trackIds: remaining } : item));
  entry.trackIds = remaining;
  res.json(entry);
});
playlistRouter.delete('/playlists/:id/tracks/:trackId',async(req,res)=>{const entry=playlists.find(item=>item.id===req.params.id);if(!entry)return res.status(404).json({error:'歌单不存在'});entry.trackIds=entry.trackIds.filter(id=>id!==req.params.trackId);await save();res.json(entry);});
playlistRouter.delete('/playlists/:id',async(req,res)=>{const index=playlists.findIndex(item=>item.id===req.params.id);if(index<0)return res.status(404).json({error:'歌单不存在'});playlists.splice(index,1);await save();res.json({ok:true});});
