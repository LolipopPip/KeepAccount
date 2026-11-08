const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const appHtml = path.join(__dirname, 'keepaccount.html');
const preload = path.join(__dirname, 'keepaccount-preload.js');
const compactWindowSize = { width: 192, height: 136 };
const expandedWindowSize = { width: 392, height: 276 };

let mainWindow = null;
let widgetWindow = null;
let persistedState = null;
let saveTimer = null;

function statePath() {
  return path.join(app.getPath('userData'), 'keepaccount-state.json');
}

function defaultState() {
  return { records: [] };
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const amount = Number(record.amount);
  const date = String(record.date || '').trim();
  const note = String(record.note || '').trim();
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
  if (!Number.isFinite(amount) || amount <= 0 || !date) return null;
  return {
    id: String(record.id || `ka_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`),
    amount: Math.round(amount * 100) / 100,
    note: note || '未命名用途',
    date,
    createdAt
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultState();
    return {
      records: Array.isArray(parsed.records) ? parsed.records.map(normalizeRecord).filter(Boolean) : []
    };
  } catch {
    return defaultState();
  }
}

function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function scheduleSave(nextState) {
  persistedState = {
    records: Array.isArray(nextState?.records) ? nextState.records.map(normalizeRecord).filter(Boolean) : []
  };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      atomicWriteJson(statePath(), persistedState);
    } catch {
      // Ignore persistence failures during save; the caller will keep running.
    }
  }, 150);
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (persistedState) {
    try {
      atomicWriteJson(statePath(), persistedState);
    } catch {
      // Ignore flush failures on shutdown.
    }
  }
}

function getDockedBounds(size) {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  return {
    x: Math.round(x + width - size.width - 24),
    y: Math.round(y + height - size.height + 4),
    width: size.width,
    height: size.height
  };
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    return widgetWindow;
  }

  widgetWindow = new BrowserWindow({
    ...getDockedBounds(compactWindowSize),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  widgetWindow.setAlwaysOnTop(true, 'screen-saver');
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.loadFile(appHtml, { query: { widget: '1', desktop: '1' } });
  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
  return widgetWindow;
}

function showWidgetWindow() {
  const win = createWidgetWindow();
  win.setBounds(getDockedBounds(compactWindowSize), false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.showInactive();
  win.moveTop();
}

function hideWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide();
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'KeepAccount · 消费记录',
    backgroundColor: '#EEF4EA',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(appHtml);
  mainWindow.on('minimize', () => {
    showWidgetWindow();
  });
  mainWindow.on('restore', () => {
    hideWidgetWindow();
  });
  mainWindow.on('show', () => {
    if (!mainWindow.isMinimized()) hideWidgetWindow();
  });
  mainWindow.on('closed', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.close();
    }
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  persistedState = loadState();
  createMainWindow();

  app.on('activate', () => {
    createMainWindow();
  });
});

ipcMain.handle('keepaccount:widget-mode', (_event, mode) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow || widgetWindow;
  if (!win || win.isDestroyed()) return false;
  const size = mode === 'compact' ? compactWindowSize : expandedWindowSize;
  win.setBounds(getDockedBounds(size), false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  return true;
});

ipcMain.handle('keepaccount:restore-main', () => {
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  hideWidgetWindow();
  return true;
});

ipcMain.handle('keepaccount-data:get', () => {
  return persistedState || loadState();
});

ipcMain.handle('keepaccount-data:save', (_event, nextState) => {
  scheduleSave(nextState);
  return true;
});

app.on('window-all-closed', () => {
  flushSave();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  flushSave();
});
