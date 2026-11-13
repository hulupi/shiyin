import { normalizeFpkModes } from './fpk-modes.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../../', import.meta.url));
const packageDir = path.join(root, 'fpk');
const tempDir = await fs.realpath(os.tmpdir());
const stage = await fs.mkdtemp(path.join(tempDir, 'shiyin-fpk-'));
const run = (command, args, cwd=root, env=process.env) => {
  const result = spawnSync(command,args,{cwd,env,stdio:'inherit',windowsHide:true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
};
if (!process.env.npm_execpath) throw Error('Run through npm run package:fpk');
const npm = (args,cwd=root,env=process.env) => run(process.execPath,[process.env.npm_execpath,...args],cwd,env);
npm(['run','build'],root,{...process.env,SHIYIN_BASE_PATH:'/app/shiyin/'});
await fs.cp(packageDir,stage,{recursive:true,filter:source=>!source.endsWith('.fpk')});
const app=path.join(stage,'app');
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const {name,version}=await readJson('package.json');
const {dependencies}=await readJson('backend/package.json');
const runtime={name,version,private:true,type:'module',dependencies};
const lock=await readJson('package-lock.json');
lock.packages['']={name,version,dependencies};
for(const [key,value] of Object.entries(lock.packages)){
  if(key === 'backend' || key.startsWith('backend/') || key === 'frontend' || key.startsWith('frontend/')||value.link)delete lock.packages[key];
}
await fs.writeFile(path.join(app,'package.json'),JSON.stringify(runtime,null,2));
await fs.writeFile(path.join(app,'package-lock.json'),JSON.stringify(lock,null,2));
async function emit(dir) {
  for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true})) {
    const relative=path.join(dir,entry.name);
    if(entry.isDirectory()) await emit(relative);
    else if(entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const target=path.join(app,relative.replace(/\.ts$/,'.js'));
      await fs.mkdir(path.dirname(target),{recursive:true});
      const source=await fs.readFile(path.join(root,relative),'utf8');
      await fs.writeFile(target,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,esModuleInterop:true}}).outputText);
    }
  }
}
await emit('backend/src');
await fs.cp(path.join(root,'backend/src/source-runtime'),path.join(app,'backend/src/source-runtime'),{recursive:true});
await fs.cp(path.join(root,'frontend/dist'),path.join(app,'frontend/dist'),{recursive:true});
// Reconcile workspace hoisting with the standalone server manifest before npm ci.
npm(['install','--package-lock-only','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],app);
npm(['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],app);
// The Linux runtime supplies Node/SQLite. Reject architecture-specific Node addons.
async function check(dir) {
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const p=path.join(dir,entry.name);
    if(entry.isDirectory()) await check(p);
    else if(/\.(node|exe|dll)$/i.test(entry.name)) throw Error('Platform binary found: '+p);
  }
}
await check(path.join(app,'node_modules'));
const fnpack=process.env.FNPACK_PATH || path.join(root,'backend','data',process.platform==='win32'?'fnpack.exe':'fnpack');
run(fnpack,['build'],stage);
const files=(await fs.readdir(stage)).filter(name=>name.endsWith('.fpk'));
if(files.length!==1) throw Error('Expected one FPK output');
const output=path.join(packageDir,`shiyin-${version}-all.fpk`);
await fs.writeFile(output,normalizeFpkModes(await fs.readFile(path.join(stage,files[0]))));
console.log('FPK: '+output);

const resolvedStage=await fs.realpath(stage);
if(path.dirname(resolvedStage)!==tempDir||!path.basename(resolvedStage).startsWith('shiyin-fpk-'))
  throw Error('Unexpected staging path: '+resolvedStage);
await fs.rm(resolvedStage,{recursive:true,force:true,maxRetries:3,retryDelay:100});
