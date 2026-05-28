/**
 * BytesProtector — Electron Main Process
 * Manages window, IPC, and spawns backend engine processes.
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path  = require('path');
const fs    = require('fs');
const { spawn, execFile } = require('child_process');
const http = require('http');
const { WebSocketServer } = require('ws');

// ─── Config paths ──────────────────────────────────────────────────────────
// ROOT = app source (inside asar in production — read-only, cannot mkdir here)
// DATA = writable user data dir (persists across updates, safe to mkdir)
const ROOT          = __dirname;
const ASSETS        = path.join(ROOT, 'assets');
const IS_PACKED     = app.isPackaged;

// In packaged builds, backend/config/python-embed are unpacked from asar
// so Python can actually read them as real files on disk.
// __dirname = .../resources/app.asar
// unpacked  = .../resources/app.asar.unpacked
const UNPACKED_ROOT = IS_PACKED
  ? ROOT.replace('app.asar', 'app.asar.unpacked')
  : ROOT;

const BACKEND_PY    = path.join(UNPACKED_ROOT, 'backend', 'python', 'engine.py');
const CONFIG_SRC    = path.join(UNPACKED_ROOT, 'config');  // read-only source config

// Writable user data dir — survives app updates
// Packaged: C:\Users\<user>\AppData\Roaming\BytesProtector
// Dev:      project root
const DATA_DIR      = IS_PACKED ? app.getPath('userData') : ROOT;
const CONFIG_PATH   = path.join(DATA_DIR, 'settings.json');
const QUAR_DIR      = path.join(DATA_DIR, 'quarantine');
const LOG_DIR       = path.join(DATA_DIR, 'logs');

// ── Python resolver ──────────────────────────────────────────────────────
// Priority: 1) bundled python-embed, 2) system python3/python
function findPython() {
  // Bundled embeddable Python (ships inside the installer — no install needed)
  const bundled = path.join(UNPACKED_ROOT, 'python-embed', 'python.exe');
  if (require('fs').existsSync(bundled)) {
    return bundled;
  }
  // System fallback (dev mode or non-Windows)
  return process.platform === 'win32' ? 'python' : 'python3';
}
const PYTHON_EXE = findPython();

// Ensure writable dirs exist (DATA_DIR is always a real directory)
[QUAR_DIR, LOG_DIR].forEach(d => {
  try { fs.mkdirSync(d, { recursive: true }); } catch(e) {
    console.error('Failed to create dir', d, e.message);
  }
});

// ─── Browser Guard state ──────────────────────────────────────────────────────
let bgStats = { blocked: 0, warned: 0, scanned: 0, clean: 0, clients: 0 };
let bgThreatDomains = [];
let bgWhitelist = new Set();

function loadThreatDomains() {
  try {
    const dbPath = path.join(UNPACKED_ROOT || ROOT, 'config', 'signatures', 'threat_db.json');
    if (fs.existsSync(dbPath)) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      bgThreatDomains = (db.malicious_domains || []).map(d => d.toLowerCase());
      console.log(`[BrowserGuard] Loaded ${bgThreatDomains.length} threat domains`);
    }
  } catch (e) {
    console.error('[BrowserGuard] Failed to load threat domains:', e.message);
  }
}
loadThreatDomains();

// ─── Browser Guard WebSocket Server ─────────────────────────────────────────
// Listens on 127.0.0.1:59876 — only accessible from the local machine.
// The browser extension connects here to check URLs and get threat intel.
const BP_WS_PORT = 59876;
let wss = null;
let browserClients = new Set();

function startBrowserGuardServer() {
  try {
    const server = http.createServer();
    wss = new WebSocketServer({ server });

    wss.on('connection', (ws, req) => {
      // Only accept localhost connections
      const ip = req.socket.remoteAddress;
      if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
        ws.close(); return;
      }

      browserClients.add(ws);
      console.log('[BrowserGuard] Extension connected');

      ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        let resp = { id: msg.id, type: 'response' };

        switch (msg.type) {

          case 'hello':
            resp.status  = 'ok';
            resp.version = '1.0.0';
            resp.engines = ['hash', 'pattern', 'yara', 'ai', 'c_heuristic', 'fuzzy', 'network_ioc', 'script'];
            // Notify renderer: browser connected
            bgStats.clients++;
            mainWindow?.webContents.send('browser-guard-event', {
              type: 'bg_client_change', clients: bgStats.clients, joined: true,
              browser: msg.browser || 'Unknown browser',
            });
            break;

          case 'check_url': {
            const urlStr = msg.url || '';
            let blocked  = false;
            let risk     = 0;
            let reason   = '';
            try {
              const urlObj   = new URL(urlStr);
              const hostname = urlObj.hostname.toLowerCase();
              // Check against threat DB domains
              const matched  = bgThreatDomains.find(d => hostname === d || hostname.endsWith('.' + d));
              if (matched) {
                blocked = true; risk = 4; reason = `Known malicious domain: ${matched}`;
              }
              // Also check whitelist
              const wl = bgWhitelist.has(hostname);
              if (wl) { blocked = false; risk = 0; }
            } catch (_) {}

            resp.blocked = blocked;
            resp.risk    = risk;
            resp.reason  = reason;

            if (blocked) {
              bgStats.blocked++;
              mainWindow?.webContents.send('browser-guard-event', {
                type: 'bg_blocked', url: msg.url, reason,
              });
            }
            break;
          }

          case 'report_blocked': {
            // Extension reports a block it did locally (pattern-based)
            bgStats.blocked++;
            mainWindow?.webContents.send('browser-guard-event', {
              type: 'bg_blocked', url: msg.url, reason: msg.reason || 'Blocked by extension',
            });
            resp.status = 'ok';
            break;
          }

          case 'report_warned': {
            bgStats.warned++;
            mainWindow?.webContents.send('browser-guard-event', {
              type: 'bg_warned', url: msg.url, reason: msg.reason || '',
            });
            resp.status = 'ok';
            break;
          }

          case 'scan_download': {
            bgStats.scanned++;
            mainWindow?.webContents.send('browser-guard-event', {
              type: 'bg_download', url: msg.url, filename: msg.filename || '', reason: msg.reason || '',
            });
            resp.status = 'queued';
            break;
          }

          case 'get_threat_domains':
            resp.domains = bgThreatDomains;
            break;

          case 'get_stats':
            resp.stats = { ...bgStats, browserGuard: true };
            break;

          case 'whitelist_domain':
            if (msg.domain) bgWhitelist.add(msg.domain.toLowerCase());
            resp.status = 'ok';
            break;
        }

        try { ws.send(JSON.stringify(resp)); } catch (_) {}
      });

      ws.on('close', () => {
        browserClients.delete(ws);
        bgStats.clients = Math.max(0, bgStats.clients - 1);
        mainWindow?.webContents.send('browser-guard-event', {
          type: 'bg_client_change', clients: bgStats.clients, joined: false,
        });
      });
      ws.on('error', () => { browserClients.delete(ws); });
    });

    server.listen(BP_WS_PORT, '127.0.0.1', () => {
      console.log(`[BrowserGuard] WebSocket server on ws://127.0.0.1:${BP_WS_PORT}`);
    });

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log('[BrowserGuard] Port already in use — another instance running?');
      }
    });

  } catch (e) {
    console.error('[BrowserGuard] Failed to start WS server:', e.message);
  }
}

// ─── Default settings ──────────────────────────────────────────────────────
let settings = {
  realtimeProtection: true,
  autoQuarantine: true,
  heuristicEngine: true,
  mlClassifier: true,
  rustHashVerifier: true,
  scanOnStartup: false,
  excludePaths: [],
};

function loadSettings() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      Object.assign(settings, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    }
  } catch (_) {}
}

function saveSettings() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2));
}

loadSettings();

// ─── Window ────────────────────────────────────────────────────────────────
let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  1000,
    minHeight: 650,
    frame: false,           // Custom titlebar
    transparent: false,
    backgroundColor: '#080809',
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(ROOT, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadFile('app/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  // NOTE: Browser Guard removed — WebSocket server not started.

  // Tray
  try {
    const trayIcon = nativeImage.createFromPath(path.join(ASSETS, 'icon.ico'))
      .resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('BytesProtector');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open',  click: () => mainWindow?.show()  },
      { label: 'Quit',  click: () => app.quit()          },
    ]));
    tray.on('double-click', () => mainWindow?.show());
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Window controls IPC ───────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ─── Settings IPC ─────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('save-settings', (_, newSettings) => {
  Object.assign(settings, newSettings);
  saveSettings();
  return true;
});

// ─── File dialog ──────────────────────────────────────────────────────────
ipcMain.handle('choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('choose-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select files to scan',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Executable & Archives', extensions: ['exe','dll','zip','bat','cmd','ps1','vbs','msi','scr','jar','py','js'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('choose-save-path', async (_, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePath;
});

// ─── Browser Guard IPC (removed) ─────────────────────────────────────────────
// Browser Guard has been removed from the app.

// ─── Auto-Update (GitHub Releases) ───────────────────────────────────────────
const GITHUB_RELEASES_API = 'https://api.github.com/repos/bytesprotector-ops/BytesProtector-Source/releases/latest';
let _pkgVersion = '1.0.0';
try { _pkgVersion = require('./package.json').version || '1.0.0'; } catch (_) {}

ipcMain.handle('check-for-update', async () => {
  try {
    const data = await new Promise((resolve, reject) => {
      const req = require('https').get(
        GITHUB_RELEASES_API,
        { headers: { 'User-Agent': 'BytesProtector-App' } },
        (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        }
      );
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    const latestTag  = (data.tag_name || '').replace(/^v/, '');
    const hasUpdate  = latestTag && latestTag !== _pkgVersion;
    const downloadUrl = data.assets?.[0]?.browser_download_url ||
                        data.html_url ||
                        'https://github.com/bytesprotector-ops/BytesProtector-Source/releases/latest';
    return { hasUpdate, currentVersion: _pkgVersion, latestVersion: latestTag,
             releaseNotes: data.body || '', downloadUrl };
  } catch (e) {
    return { error: e.message, hasUpdate: false };
  }
});

ipcMain.handle('open-download-url', async (_, url) => {
  if (url && url.startsWith('https://')) {
    await require('electron').shell.openExternal(url);
  }
  return true;
});


// ─── Scan IPC ─────────────────────────────────────────────────────────────
let scanProcess = null;

ipcMain.handle('start-scan', async (event, { paths, files, scanType }) => {
  if (scanProcess) return { error: 'Scan already running' };

  return new Promise((resolve) => {
    let args;

    if (scanType === 'endpoint') {
      // Launch endpoint daemon instead of scanner
      args = [BACKEND_PY, '--endpoint'];
    } else {
      args = [BACKEND_PY, '--scan', '--type', scanType,
              '--quarantine-dir', QUAR_DIR];
      if (files && files.length > 0) {
        args.push('--files', ...files);
      } else if (paths && paths.length > 0) {
        args.push('--paths', ...paths);
      }
    }

    scanProcess = spawn(PYTHON_EXE, args);
    let output = '';

    scanProcess.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Stream each line as an event
      text.split('\n').filter(Boolean).forEach(line => {
        try {
          const msg = JSON.parse(line);
          mainWindow?.webContents.send('scan-event', msg);
        } catch (_) {
          mainWindow?.webContents.send('scan-event', { type: 'log', text: line });
        }
      });
    });

    scanProcess.stderr.on('data', (data) => {
      mainWindow?.webContents.send('scan-event', {
        type: 'log', text: data.toString(), level: 'warn'
      });
    });

    scanProcess.on('close', (code) => {
      scanProcess = null;
      mainWindow?.webContents.send('scan-event', { type: 'done', code });
      resolve({ code });
    });
  });
});

ipcMain.on('stop-scan', () => {
  if (scanProcess) {
    scanProcess.kill();
    scanProcess = null;
  }
});

// ─── Quarantine IPC ───────────────────────────────────────────────────────
ipcMain.handle('get-quarantine', () => {
  const idx = path.join(QUAR_DIR, 'index.json');
  try {
    return fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, 'utf8')) : [];
  } catch (_) { return []; }
});

ipcMain.handle('quarantine-delete-all', () => {
  const idx = path.join(QUAR_DIR, 'index.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (_) {}
  items.forEach(item => {
    try { fs.unlinkSync(item.quarfile); } catch (_) {}
  });
  fs.writeFileSync(idx, '[]');
  return true;
});

ipcMain.handle('quarantine-restore', (_, id) => {
  const idx = path.join(QUAR_DIR, 'index.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (_) { return { ok: false, error: 'index read failed' }; }
  const item = items.find(i => i.id === id);
  if (!item) return { ok: false, error: 'item not found' };
  try {
    const enc = fs.readFileSync(item.quarfile);
    const dec = Buffer.from(enc.map(b => b ^ 0xAA));
    // Restore to original path, or Desktop if original is gone/unsafe
    let dest = item.path;
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      dest = path.join(require('os').homedir(), 'Desktop', item.name);
    }
    fs.writeFileSync(dest, dec);
    fs.unlinkSync(item.quarfile);
    const updated = items.filter(i => i.id !== id);
    fs.writeFileSync(idx, JSON.stringify(updated, null, 2));
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('quarantine-delete-item', (_, id) => {
  const idx = path.join(QUAR_DIR, 'index.json');
  let items = [];
  try { items = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch (_) { return false; }
  const item = items.find(i => i.id === id);
  if (!item) return false;
  try { fs.unlinkSync(item.quarfile); } catch (_) {}
  const updated = items.filter(i => i.id !== id);
  fs.writeFileSync(idx, JSON.stringify(updated, null, 2));
  return true;
});

// ─── Reports IPC ──────────────────────────────────────────────────────────
ipcMain.handle('get-report', () => {
  const rp = path.join(LOG_DIR, 'scan_history.json');
  try {
    return fs.existsSync(rp) ? JSON.parse(fs.readFileSync(rp, 'utf8')) : [];
  } catch (_) { return []; }
});

ipcMain.handle('export-report', (_, filePath) => {
  const rp = path.join(LOG_DIR, 'scan_history.json');
  try {
    const data = fs.existsSync(rp) ? fs.readFileSync(rp, 'utf8') : '[]';
    fs.writeFileSync(filePath, data);
    return true;
  } catch (_) { return false; }
});
