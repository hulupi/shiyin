const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('desktop', true);

if (process.isMainFrame) contextBridge.exposeInMainWorld('desktopPlayback', {
  read: () => ipcRenderer.sendSync('desktop:read-playback'),
  save: (state) => ipcRenderer.sendSync('desktop:save-playback', state),
});

if (process.isMainFrame) window.addEventListener('DOMContentLoaded', () => {
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