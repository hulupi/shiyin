const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, utilityProcess } = require('electron');
const path = require('node:path');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

let backend;
let player;
let tray;
let quitting = false;

function showPlayer() {
  if (!player || player.isDestroyed()) return;
  if (player.isMinimized()) player.restore();
  player.show();
  player.focus();
}

async function start() {
  const runtime = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.join(__dirname, 'build', 'runtime');
  const key = randomUUID();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '0',
    SHIYIN_DATA_DIR: path.join(app.getPath('userData'), 'library'),
    SHIYIN_DESKTOP_KEY: key,
  };
  delete env.SHIYIN_SOCKET_PATH;
  delete env.SHIYIN_GATEWAY_PREFIX;
  backend = utilityProcess.fork(path.join(runtime, 'launch.cjs'), [], { env, stdio: 'pipe' });
  let output = '';
  backend.stderr.on('data', (chunk) => { output = (output + chunk).slice(-2500); });
  backend.stdout.resume();

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('本地服务启动超时。')), 20000);
    backend.once('message', ({ port }) => {
      clearTimeout(timeout);
      resolve(port);
    });
    backend.once('exit', (code) => {
      clearTimeout(timeout);
      const message = '本地服务已退出 (' + code + ')。\n' + output;
      reject(new Error(message));
      if (player && !quitting) {
        dialog.showErrorBox('拾音', message);
        app.quit();
      }
    });
  });

  const origin = 'http://127.0.0.1:' + port;
  player = new BrowserWindow({
    title: '拾音',
    width: 1280,
    height: 850,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#101311',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'title-bar.cjs'),
    },
  });
  player.setMenu(null);
  const contents = player.webContents;
  const statePath = path.join(app.getPath('userData'), 'playback.json');
  const isPlayer = (event) => event.sender.id === contents.id;
  ipcMain.on('desktop:read-playback', (event) => {
    if (!isPlayer(event)) { event.returnValue = null; return; }
    try { event.returnValue = JSON.parse(readFileSync(statePath, 'utf8')); } catch { event.returnValue = null; }
  });
  ipcMain.on('desktop:save-playback', (event, state) => {
    if (!isPlayer(event)) { event.returnValue = false; return; }
    try {
      writeFileSync(statePath + '.tmp', JSON.stringify(state));
      renameSync(statePath + '.tmp', statePath);
      event.returnValue = true;
    } catch (error) {
      event.returnValue = false;
      console.error('无法保存播放状态', error);
    }
  });
  tray = new Tray(path.join(runtime, 'tray.png'));
  tray.setToolTip('拾音');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开拾音', click: showPlayer },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.on('click', showPlayer);
  player.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    player.hide();
  });
  const titleBarCss = readFileSync(path.join(__dirname, 'title-bar.css'), 'utf8');
  contents.on('dom-ready', () => { void contents.insertCSS(titleBarCss, { cssOrigin: 'user' }); });
  ipcMain.on('desktop:window-action', (event, action) => {
    if (!isPlayer(event)) return;
    if (action === 'minimize') player.minimize();
    if (action === 'close') player.close();
  });
  contents.session.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => {
    if (details.webContentsId === contents.id) details.requestHeaders['X-Shiyin-Desktop'] = key;
    callback({ requestHeaders: details.requestHeaders });
  });
  const restrictNavigation = (event, destination) => {
    const url = typeof destination === 'string' ? destination : destination.url;
    if (new URL(url).origin !== origin) event.preventDefault();
  };
  contents.on('will-navigate', restrictNavigation);
  contents.on('will-redirect', restrictNavigation);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  await player.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showPlayer);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    tray?.destroy();
    backend?.kill();
  });
  void app.whenReady().then(start).catch((error) => {
    if (!quitting) dialog.showErrorBox('拾音启动失败', error.message);
    app.quit();
  });
}
