import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { initSteam } from './steam/steam';

const DEV = !app.isPackaged;
const DEV_URL = process.env.LF_DEV_URL || 'http://localhost:5173';

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0e16',
    autoHideMenuBar: true,
    title: 'Last Fortress',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  if (DEV) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(process.resourcesPath, 'client', 'index.html'));
  }

  // external links open in the OS browser, never in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // in dev, the Vite server may not be up yet — retry the load
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} ${url}`);
    if (DEV) setTimeout(() => win?.loadURL(DEV_URL), 800);
  });

  // forward renderer console + crashes to the main process stdout — otherwise
  // they live only in detached DevTools and can't be tailed from the terminal
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['V', 'I', 'W', 'E'][level] ?? String(level);
    const src = sourceId ? sourceId.split(/[\\/]/).pop() : '';
    console.log(`[renderer ${tag}] ${message}${src ? `  (${src}:${line})` : ''}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log(`[renderer GONE] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.log(`[preload ERROR] ${preloadPath}: ${error.message}`);
  });

  win.on('closed', () => { win = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    initSteam();   // no-op until a Steam App ID is configured (Phase B)
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
