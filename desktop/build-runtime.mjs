import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'desktop', 'build', 'runtime');
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

function npm(args, cwd, env = process.env) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('npm ' + args.join(' ') + ' failed');
}

async function emit(relative) {
  const source = path.join(root, relative);
  const target = path.join(runtime, relative);
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await emit(path.join(relative, entry.name));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      const code = await fs.readFile(path.join(source, entry.name), 'utf8');
      const { outputText } = ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      });
      await fs.writeFile(path.join(target, entry.name.replace(/\.ts$/, '.js')), outputText);
    } else if (/\.(mjs|js)$/.test(entry.name)) {
      await fs.copyFile(path.join(source, entry.name), path.join(target, entry.name));
    }
  }
}

npm(['run', 'build', '-w', 'frontend', '--', '--outDir', path.join(runtime, 'frontend', 'dist'), '--emptyOutDir'],
  root, { ...process.env, SHIYIN_BASE_PATH: '/' });

const { dependencies } = await readJson('backend/package.json');
const { name, version } = await readJson('package.json');
const lock = await readJson('package-lock.json');
lock.packages[''] = { name, version, dependencies };
for (const [key, value] of Object.entries(lock.packages)) {
  if (/^(backend|frontend)(\/|$)/.test(key) || value.link) delete lock.packages[key];
}
await fs.writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name, version, private: true, type: 'module', dependencies }));
await fs.writeFile(path.join(runtime, 'package-lock.json'), JSON.stringify(lock));
await fs.copyFile(path.join(root, 'desktop', 'launch.cjs'), path.join(runtime, 'launch.cjs'));
const appIcon = path.join(root, 'fpk', 'ICON_256.PNG');
await fs.copyFile(appIcon, path.join(runtime, 'tray.png'));
if (process.platform === 'darwin') {
  const desktop = path.dirname(runtime);
  const icon = path.join(desktop, 'icon-mac.png');
  const result = spawnSync('sips', [
    '-z', '432', '432', '-p', '512', '512', appIcon, '--out', icon,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Failed to prepare macOS application icon');
  for (const name of ['trayTemplate.png', 'trayTemplate@2x.png']) {
    await fs.copyFile(path.join(root, 'desktop', name), path.join(runtime, name));
  }
}
await emit('backend/src');
npm(['install', '--package-lock-only', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtime);
