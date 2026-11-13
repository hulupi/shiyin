import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../config/paths.js';

mkdirSync(dataDir,{recursive:true,mode:0o700});
export const databasePath=path.join(dataDir,'shiyin.sqlite');
const db=new DatabaseSync(databasePath);
chmodSync(databasePath,0o600);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS directories(id TEXT PRIMARY KEY,path TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_tracks(id TEXT PRIMARY KEY,directory_id TEXT,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,available INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS local_tracks_title ON local_tracks(title);
CREATE INDEX IF NOT EXISTS local_tracks_directory ON local_tracks(directory_id);
CREATE TABLE IF NOT EXISTS online_tracks(id TEXT PRIMARY KEY,platform TEXT,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites(track_id TEXT PRIMARY KEY,position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS history(track_id TEXT PRIMARY KEY,position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT,enabled INTEGER NOT NULL,priority INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sources_priority ON sources(priority);
CREATE TABLE IF NOT EXISTS source_scripts(id TEXT PRIMARY KEY,script TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_tracks(playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,track_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(playlist_id,track_id));
CREATE TABLE IF NOT EXISTS downloads(id TEXT PRIMARY KEY,track_id TEXT,status TEXT,created_at TEXT,payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS downloads_status ON downloads(status);
CREATE TABLE IF NOT EXISTS bindings(online_id TEXT PRIMARY KEY,local_id TEXT NOT NULL);`);

let depth=0;
export function transaction<T>(action:()=>T):T {
  if(depth)return action();db.exec('BEGIN IMMEDIATE');depth++;
  try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}finally{depth--;}
}
type RecordTable='directories'|'local_tracks'|'online_tracks'|'sources'|'playlists'|'downloads';
const fields:Record<RecordTable,string[]>={directories:['path'],local_tracks:['directory_id','title','artist','album','available'],online_tracks:['platform'],sources:['name','enabled','priority'],playlists:['name'],downloads:['track_id','status','created_at']};
function columns(table:RecordTable,value:any){return fields[table].map(key=>{if(key==='available'||key==='enabled')return value[key]?1:0;if(key==='directory_id')return value.directoryId||'';if(key==='track_id')return value.trackId||'';if(key==='created_at')return value.createdAt||'';return value[key]??'';});}
export function loadRecords<T>(table:RecordTable):T[]{return db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(row=>JSON.parse(String(row.payload)));}
export function upsertRecord(table:RecordTable,value:{id:string}) {
  const payload=JSON.stringify(value),existing=db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(value.id);
  if(existing?.payload===payload)return;
  const names=['id',...fields[table],'payload'];
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${names.slice(1).map(name=>`${name}=excluded.${name}`).join(',')}`).run(value.id,...columns(table,value),payload);
}
export function replaceRecords(table:RecordTable,values:{id:string}[]) {
  transaction(()=>{const wanted=new Set(values.map(value=>value.id));for(const row of db.prepare(`SELECT id FROM ${table}`).all())if(!wanted.has(String(row.id)))db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);for(const value of values)upsertRecord(table,value);});
}
export function loadSetting<T>(key:string,fallback:T):T {const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(String(row.value)):fallback;}
export function saveSetting(key:string,value:unknown){db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
export function loadIds(table:'favorites'|'history'):string[]{return db.prepare(`SELECT track_id FROM ${table} ORDER BY position`).all().map(row=>String(row.track_id));}
export function saveIds(table:'favorites'|'history',ids:string[]){if(JSON.stringify(loadIds(table))===JSON.stringify(ids))return;transaction(()=>{db.exec(`DELETE FROM ${table}`);const statement=db.prepare(`INSERT INTO ${table}(track_id,position) VALUES(?,?)`);[...new Set(ids)].forEach((id,index)=>statement.run(id,index));});}
export function loadBindings():Record<string,string>{return Object.fromEntries(db.prepare('SELECT online_id,local_id FROM bindings').all().map(row=>[String(row.online_id),String(row.local_id)]));}
export function removeLocalBindings(id:string){db.prepare('DELETE FROM bindings WHERE local_id=?').run(id);}
export function saveBinding(onlineId:string,localId:string){db.prepare('INSERT INTO bindings(online_id,local_id) VALUES(?,?) ON CONFLICT(online_id) DO UPDATE SET local_id=excluded.local_id').run(onlineId,localId);}
export function readScript(id:string):string{const row=db.prepare('SELECT script FROM source_scripts WHERE id=?').get(id);if(!row)throw new Error('音源脚本不存在，请重新导入');return String(row.script);}
export function hasSourceScript(script: string) {
  return !!db.prepare('SELECT 1 FROM source_scripts WHERE script=? LIMIT 1').get(script);
}
export function writeScript(id:string,script:string){db.prepare('INSERT INTO source_scripts(id,script) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET script=excluded.script').run(id,script);}
export function deleteScript(id:string){db.prepare('DELETE FROM source_scripts WHERE id=?').run(id);}
export function loadPlaylists<T extends {id:string;trackIds:string[]}>():T[]{return loadRecords<T>('playlists').map(item=>({...item,trackIds:db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY position').all(item.id).map(row=>String(row.track_id))}));}
export function savePlaylists(items:{id:string;name:string;createdAt:string;trackIds:string[]}[]){transaction(()=>{replaceRecords('playlists',items.map(({trackIds:_ids,...item})=>item));const remove=db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=?'),add=db.prepare('INSERT INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)');for(const item of items){remove.run(item.id);[...new Set(item.trackIds)].forEach((id,index)=>add.run(item.id,id,index));}});}
export function searchLocalRecords<T>(keyword:string,albumsOnly=false):T[]{
  const words=keyword.trim().split(/\s+/).filter(Boolean).slice(0,12);
  if(!words.length)return [];
  const fields=albumsOnly?"(artist||' '||album)":"(title||' '||artist||' '||album)";
  const clause=words.map(()=>fields+" LIKE ? ESCAPE '\\'").join(' AND ');
  return db.prepare(`SELECT payload FROM local_tracks WHERE available=1 AND ${clause} ORDER BY CASE WHEN title=? THEN 0 ELSE 1 END,title COLLATE NOCASE`).all(...words.map(word=>'%'+word.replace(/[\\%_]/g,'\\$&')+'%'),keyword.trim()).map(row=>JSON.parse(String(row.payload)));
}

// Upgrade once, in a single transaction. Original files are never removed.
