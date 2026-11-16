export const platforms = ['wy','tx','kw','kg','mg'] as const;
export const qualities = ['128k','320k','flac','flac24bit'];
export interface SourceEntry {
  id:string; name:string; version:string; author:string; description:string;
  enabled:boolean; priority:number; importedAt:string;
  capabilities:Record<string,{actions:string[];qualitys:string[]}>;
}
const supportedPlatforms = new Set<string>([...platforms, 'local']);
export function scriptInfo(script:string) {
  const header = /^\s*(?:\uFEFF)?\/\*[*!]([\s\S]*?)\*\//.exec(script)?.[1];
  const field = (key:string) => new RegExp(`@${key}\\s+([^\\r\\n*]+)`).exec(header || '')?.[1].trim().slice(0,256) || '';
  if(!header || !field('name'))throw new Error('无效音源：脚本开头必须包含 @name 信息');
  return {name:field('name'),version:field('version'),author:field('author'),description:field('description'),homepage:field('homepage'),rawScript:script};
}
export function capabilities(data:unknown):SourceEntry['capabilities'] {
  const input = data as {status?:boolean;sources?:Record<string,{actions?:unknown;qualitys?:unknown}>};
  if(!input || input.status===false || !input.sources)throw new Error('音源初始化失败或没有声明平台');
  const result:SourceEntry['capabilities']={};
  for(const platform of supportedPlatforms) {
    const value=input.sources[platform];if(!value)continue;
    const actions=Array.isArray(value.actions)?value.actions.filter((action:string)=>['musicUrl','lyric','pic'].includes(action)):[];
    const qualitys=Array.isArray(value.qualitys)?value.qualitys.filter((quality:string)=>qualities.includes(quality)):[];
    if(actions.length)result[platform]={actions,qualitys};
  }
  if(!Object.keys(result).length)throw new Error('音源没有声明可用能力');
  return result;
}

