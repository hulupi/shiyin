import { spawn, execFileSync } from 'node:child_process';
if (!process.env.npm_execpath) throw new Error('Please launch through npm run dev');
const windows = process.platform === 'win32';
const children = ['backend', 'frontend'].map(workspace =>
  spawn(process.execPath, [process.env.npm_execpath, 'run', 'dev', '--workspace', workspace],
    { stdio: 'inherit', detached: !windows }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (windows) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else process.kill(-child.pid, 'SIGTERM');
    } catch { /* Child may have exited already. */ }
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
  child.on('exit', code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
}
