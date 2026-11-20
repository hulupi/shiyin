const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('desktop', true);
if (process.isMainFrame) contextBridge.exposeInMainWorld('desktopChooseDirectory', (defaultPath) =>
  ipcRenderer.invoke('desktop:choose-directory', defaultPath));

if (process.isMainFrame) contextBridge.exposeInMainWorld('desktopPlayback', {
  read: () => ipcRenderer.sendSync('desktop:read-playback'),
  save: (state) => ipcRenderer.sendSync('desktop:save-playback', state),
});

if (process.isMainFrame && process.platform === 'darwin') window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const syncTheme = () => {
    ipcRenderer.send('desktop:theme', root.classList.contains('light') ? 'light' : 'dark');
  };
  new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['class'] });
  syncTheme();
});

if (process.isMainFrame && process.platform !== 'darwin') window.addEventListener('DOMContentLoaded', () => {
  const controls = document.createElement('div');
  controls.className = 'desktop-window-controls';
  for (const [action, label, symbol] of [
    ['minimize', '最小化', '−'],
    ['close', '隐藏到托盘', '×'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = symbol;
    button.addEventListener('click', () => ipcRenderer.send('desktop:window-action', action));
    controls.append(button);
  }
  document.body.prepend(controls);
});
