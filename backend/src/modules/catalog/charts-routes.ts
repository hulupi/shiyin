import { Router } from 'express';
import { listCharts, chartTracks } from './charts.js';

const platforms = new Set(['wy','tx','kw','kg','mg']);
export const chartsRouter=Router();
chartsRouter.get('/charts/:platform',async(req,res)=>{
  if(!platforms.has(req.params.platform))return res.status(400).json({error:'不支持的榜单平台'});
  res.json({charts:await listCharts(req.params.platform,req.query.refresh==='1')});
});
chartsRouter.get('/charts/:platform/:id',async(req,res)=>{
  const page=Number(req.query.page||1);
  if(!platforms.has(req.params.platform)||!/^\d{1,16}$/.test(req.params.id)||!Number.isSafeInteger(page)||page<1||page>100)return res.status(400).json({error:'无效的榜单参数'});
  res.json(await chartTracks(req.params.platform,req.params.id,page,req.query.refresh==='1'));
});
