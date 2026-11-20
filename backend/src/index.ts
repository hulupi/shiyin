import { recordPlaybackOutcome, sourceActivity } from './modules/sources/activity.js';
import express from 'express';
import path from 'node:path';
import { chmodSync } from 'node:fs';
import { parseFile } from 'music-metadata';
import { state, save, publicTrack, dataDir, root } from './db/store.js';
import { deleteTrackFiles, addDirectory, authorizedFile, scan, startScan, cancelScan } from './modules/library/service.js';
import { lyrics } from './modules/lyrics/service.js';
import { playlistRouter, removeDeletedTrack } from './modules/playlists/service.js';
import { downloadRouter, cancelDirectoryDownloads, downloadOnFavorite } from './modules/downloads/service.js';
import { clearLocalBindings, onlineRouter, onlineTracks, publicOnlineTrack, getOnlineTrack, saveOnlineTrack } from './modules/playback/online.js';
import { discoverRouter } from './modules/catalog/discover-routes.js';
import { backupRouter } from './modules/backup.js';
import { chartsRouter } from './modules/catalog/charts-routes.js';
const gatewayPrefix = process.env.SHIYIN_GATEWAY_PREFIX || '';
const socketPath = process.env.SHIYIN_SOCKET_PATH;
if (process.env.NODE_ENV === 'production' && (!socketPath || gatewayPrefix !== '/app/shiyin')) throw Error('Production requires the fnOS gateway and Unix Socket');
const app = express();
const desktopKey = process.env.SHIYIN_DESKTOP_KEY;
if (desktopKey) app.use((req,res,next) => {
  if (req.get('x-shiyin-desktop') !== desktopKey) return res.sendStatus(403);
  next();
});
if (gatewayPrefix) {
  app.use((req,res,next) => {
    if (req.path !== gatewayPrefix && !req.path.startsWith(gatewayPrefix + '/')) return res.sendStatus(404);
    if (!req.headers['x-trim-userid']) return res.sendStatus(401);
    if (req.path === gatewayPrefix) return res.redirect(308, gatewayPrefix + '/');
    req.url = req.url.slice(gatewayPrefix.length);
    next();
  });
}
app.disable('x-powered-by'); app.use('/api/sources/import', express.json({ limit: '7mb' }));
app.post('/api/playlists/import', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '16kb' }));
app.use('/api', (req,res,next) => {
  const writes = !['GET','HEAD'].includes(req.method);
  // The fnOS gateway may rewrite Host. A custom header forces foreign browser
  // origins to preflight; this server deliberately does not enable CORS.
  if (writes && gatewayPrefix && (req.get('x-shiyin-request') !== '1' ||
      (req.get('sec-fetch-site') && !['same-origin','none'].includes(req.get('sec-fetch-site')!)))) {
    return res.status(403).json({ error: '请求来源无效，请刷新应用页面后重试' });
  }
  if (writes && req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || (!gatewayPrefix && origin.host !== req.headers.host)) {
        return res.status(403).json({ error: '请求来源无效，请从应用页面提交操作' });
      }
    } catch {
      return res.status(403).json({ error: '请求来源格式无效' });
    }
  }
  next();
});
app.use('/api', backupRouter);
app.use('/api', onlineRouter);
app.use('/api', playlistRouter);
app.use('/api', chartsRouter);
app.use('/api', discoverRouter);
app.use('/api', downloadRouter);
app.get('/api/library', (req,res) => {
  const onlineTracksList = Object.values(onlineTracks).map(publicOnlineTrack);
  if (req.query.onlineOnly !== '1') return res.json({ ...state, tracks: state.tracks.map(publicTrack), onlineTracks: onlineTracksList, scan });
  const onlineIds = new Set(onlineTracksList.map(track => track.id));
  res.json({ directories: [], tracks: [], onlineTracks: onlineTracksList, favorites: state.favorites.filter(id => onlineIds.has(id)), history: state.history.filter(id => onlineIds.has(id)), scan: { running: false, scanned: 0, failed: 0, errors: [] } });
});
app.post('/api/directories', async (req,res) => { if(scan.running) return res.status(409).json({error:'请等待扫描结束'}); if(typeof req.body.path !== 'string') return res.status(400).json({error:'请输入目录'}); const entry = await addDirectory(req.body.path.trim()); startScan(); res.status(201).json(entry); });
app.put('/api/directories/:id', async (req, res) => {
  if (scan.running) return res.status(409).json({ error: '请等待扫描结束' });
  if (typeof req.body.path !== 'string') return res.status(400).json({ error: '请输入目录' });
  const entry = await addDirectory(req.body.path.trim(), req.params.id);
  if (entry.id !== req.params.id) cancelDirectoryDownloads(req.params.id);
  startScan();
  res.json(entry);
});
app.delete('/api/directories/:id', async (req,res) => { if(scan.running) return res.status(409).json({error:'请先取消扫描并等待结束'}); cancelDirectoryDownloads(req.params.id); state.directories = state.directories.filter(d => d.id !== req.params.id); state.tracks = state.tracks.filter(t => t.directoryId !== req.params.id); await save(); res.json({ok:true}); });
app.post('/api/scan', (_req,res) => { startScan(); res.status(202).json(scan); });
app.post('/api/scan/cancel', (_req,res) => { cancelScan(); res.json({ok:true}); });
app.post('/api/favorites/remove-batch',async(req,res)=>{
  const ids=req.body.trackIds;
  if(!Array.isArray(ids)||ids.length>200||ids.some(id=>typeof id!=='string'))return res.status(400).json({error:'无效的歌曲列表'});
  const selected=new Set(ids);
  state.favorites=state.favorites.filter(id=>!selected.has(id));
  await save();
  res.json(state.favorites);
});
app.post('/api/favorites/:id', async (req,res) => {
  const id = req.params.id;
  const track = state.tracks.some(item => item.id === id) ? undefined : getOnlineTrack(id);
  if (track) await saveOnlineTrack(track);
  const added = !state.favorites.includes(id);
  state.favorites = added ? [...state.favorites,id] : state.favorites.filter(value => value !== id);
  await save();
  const download = added && req.query.onlineOnly !== '1' ? await downloadOnFavorite(track) : undefined;
  res.json(req.query.feedback === '1' ? {favorites:state.favorites,download} : state.favorites);
});
app.post('/api/history/:id', async (req,res) => {
  const local = state.tracks.find(t => t.id === req.params.id);
  if (local) {
    if (req.body?.logPlayback === true)
      sourceActivity('playback', local, local.format).record('playing', { source: '本地文件', quality: local.format });
  } else {
    const track = getOnlineTrack(req.params.id);
    await saveOnlineTrack(track);
    recordPlaybackOutcome(track, req.body?.activityId, 'playing');
  }
  state.history = [req.params.id, ...state.history.filter(id => id !== req.params.id)].slice(0,1000);
  await save(); res.json(state.history);
});
app.delete('/api/history', async (_req,res) => { state.history=[]; await save(); res.json([]); });
app.delete('/api/tracks/:id/file',async(req,res)=>{const result=await deleteTrackFiles(req.params.id);await removeDeletedTrack(req.params.id);clearLocalBindings(req.params.id);res.json(result);});
app.get('/api/tracks/:id/details',(req,res)=>{const track=state.tracks.find(item=>item.id===req.params.id);if(!track)return res.status(404).json({error:'歌曲不存在'});res.json({...publicTrack(track),fileLocation:track.path});});
app.get('/api/tracks/:id/download',async(req,res,next)=>{const track=state.tracks.find(item=>item.id===req.params.id);if(!track)return res.status(404).json({error:'歌曲不存在'});const file=await authorizedFile(track);
  const activity=sourceActivity('download',track,track.format);
  res.download(file,error=>{
    activity.record(error?'failed':'completed',{source:'本地文件',quality:track.format,format:track.format});
    if(error)next(error);
  });});
app.get('/api/tracks/:id/:action', async (req,res,next) => {
  const track = state.tracks.find(t => t.id === req.params.id); if(!track) return res.status(404).json({error:'歌曲不存在'});
  const file = await authorizedFile(track);
  if(req.params.action === 'audio') { res.setHeader('Cache-Control','private, no-store'); return res.sendFile(file, error => { if(error) next(error); }); }
  if(req.params.action === 'lyrics') return res.json({ text: await lyrics(track) });
  if(req.params.action === 'cover') { if(track.coverPath)return res.sendFile(await authorizedFile(track,'cover')); const metadata = await parseFile(file); const picture = metadata.common.picture?.[0]; if(!picture) return res.sendStatus(404); res.setHeader('Content-Type',picture.format); res.setHeader('Cache-Control','private, max-age=3600'); return res.send(Buffer.from(picture.data)); }
  res.sendStatus(404);
});
app.use(express.static(path.join(root,'frontend/dist')));
app.use((error: Error, _req: express.Request,res: express.Response,_next: express.NextFunction) => { console.error(error.message); if(!res.headersSent) res.status(400).json({error:error.name==='TimeoutError'?'音源请求超时，请重试':error.name==='AbortError'?'请求已取消':error.message || '请求失败'}); });
const port = Number(process.env.PORT || 3180); const host = process.env.HOST || '127.0.0.1';
export const server = socketPath
  ? app.listen(socketPath, () => { chmodSync(socketPath, 0o666); console.log('拾音: ' + socketPath); })
  : app.listen(port,host,() => console.log('拾音: http://' + host + ':' + port));
server.on('error', error => { console.error(error); process.exit(1); });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
});
