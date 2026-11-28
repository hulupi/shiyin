import { Router } from 'express';
import { createCatalogCache, listCharts } from './charts.js';
import { discoverFilters, discoverPlaylists, discoverTracks, searchPlaylists } from './discover.js';

const platforms=new Set(['wy','tx','kw','kg','mg']);
export const discoverRouter=Router();
discoverRouter.use('/discover/:platform', (req,res,next)=>{
  if(!platforms.has(req.params.platform))return res.status(400).json({error:'不支持的歌单平台'});
  const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>500)return res.status(400).json({error:'无效页码'});next();
});
const cachedHome = createCatalogCache(6 * 60 * 60 * 1000);
const homePlaylistLimit = 16;

async function homePlaylists(platform: string, refresh: boolean) {
  const first = await discoverPlaylists(platform, 1, refresh);
  const playlists = new Map(first.charts.map(playlist => [playlist.id, playlist]));
  let result = first;
  for (let page = 2; result.hasMore && playlists.size < homePlaylistLimit; page++) {
    result = await discoverPlaylists(platform, page, refresh);
    const previousSize = playlists.size;
    for (const playlist of result.charts) {
      if (!playlists.has(playlist.id)) playlists.set(playlist.id, playlist);
    }
    if (playlists.size === previousSize) break;
  }
  return [...playlists.values()].slice(0, homePlaylistLimit);
}

discoverRouter.get('/home/:platform', async (req, res) => {
  const { platform } = req.params;
  if (!platforms.has(platform)) return res.status(400).json({ error: '不支持的音乐平台' });

  const refresh = req.query.refresh === '1';
  const [charts, playlists] = await Promise.allSettled([
    cachedHome(`charts:${platform}`, refresh, async () =>
      (await listCharts(platform, refresh)).slice(0, 8)),
    cachedHome(`playlists:${platform}:${homePlaylistLimit}`, refresh, () =>
      homePlaylists(platform, refresh)),
  ]);

  res.set('Cache-Control', 'no-store').json({
    charts: charts.status === 'fulfilled' ? charts.value : null,
    playlists: playlists.status === 'fulfilled' ? playlists.value : null,
  });
});

discoverRouter.get('/discover/:platform/search',async(req,res)=>{
  const keyword=typeof req.query.q==='string'?req.query.q.trim():'';
  if(!keyword||keyword.length>100)return res.status(400).json({error:'请输入 1–100 字的歌单关键词'});
  res.json(await searchPlaylists(req.params.platform,keyword,Number(req.query.page||1),req.query.refresh==='1'));
});
discoverRouter.get('/discover/:platform/filters',async(req,res)=>res.json(await discoverFilters(req.params.platform,req.query.refresh==='1')));
discoverRouter.get('/discover/:platform',async(req,res)=>{
  const sort=typeof req.query.sort==='string'?req.query.sort:undefined;
  const category=typeof req.query.category==='string'?req.query.category:'all';
  if(category.length>80||sort&&sort.length>20)return res.status(400).json({error:'无效筛选参数'});
  res.json(await discoverPlaylists(req.params.platform,Number(req.query.page||1),req.query.refresh==='1',sort,category));
});
discoverRouter.get('/discover/:platform/:id',async(req,res)=>{
  if(!/^\d{1,16}$/.test(req.params.id))return res.status(400).json({error:'无效歌单 ID'});
  res.json(await discoverTracks(req.params.platform,req.params.id,Number(req.query.page||1),req.query.refresh==='1'));
});
