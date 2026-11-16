import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeFpkModes } from './fpk-modes.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const image = process.argv[2] ?? `ghcr.io/hulupi/shiyin:${version}`;
if (!/^[a-z0-9][a-zA-Z0-9._:/@-]*$/.test(image)) {
  throw new Error('Expected a Docker image reference');
}

const stage = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shiyin-docker-fpk-'));
try {
  await fs.cp(path.join(root, 'fpk-docker'), stage, {
    recursive: true,
    filter: source => !source.endsWith('.fpk'),
  });
  for (const icon of ['ICON.PNG', 'ICON_256.PNG']) {
    await fs.copyFile(path.join(root, 'fpk', icon), path.join(stage, icon));
  }
  await fs.cp(path.join(root, 'fpk/app/ui/images'), path.join(stage, 'app/ui/images'), { recursive: true });
  const manifestPath = path.join(stage, 'manifest');
  const manifest = await fs.readFile(manifestPath, 'utf8');
  await fs.writeFile(manifestPath, manifest.replace(/^version=.*$/m, `version=${version}`).replace(/\r\n/g, '\n'));
  const composePath = path.join(stage, 'app/docker/docker-compose.yaml');
  const compose = await fs.readFile(composePath, 'utf8');
  await fs.writeFile(composePath, compose.replace('@SHIYIN_IMAGE@', image));
  const mainPath = path.join(stage, 'cmd/main');
  const main = await fs.readFile(mainPath, 'utf8');
  await fs.writeFile(mainPath, main.replace(/\r\n/g, '\n').trimEnd() + '\n');
  await fs.chmod(mainPath, 0o755);

  const defaultFnpack = path.join(root, 'backend/data', process.platform === 'win32' ? 'fnpack.exe' : 'fnpack');
  const fnpack = process.env.FNPACK_PATH || await fs.access(defaultFnpack).then(() => defaultFnpack, () => 'fnpack');
  execFileSync(fnpack, ['build'], { cwd: stage, stdio: 'inherit' });
  const packages = (await fs.readdir(stage)).filter(name => name.endsWith('.fpk'));
  if (packages.length !== 1) throw new Error('Expected one FPK output');
  const target = path.join(root, 'fpk-docker', `shiyin-docker-${version}-all.fpk`);
  await fs.writeFile(target, normalizeFpkModes(await fs.readFile(path.join(stage, packages[0]))));
  console.log(`FPK: ${target}\nImage: ${image}`);
} finally {
  await fs.rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
