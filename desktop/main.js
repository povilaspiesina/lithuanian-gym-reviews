const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const zlib = require('zlib');

let mainWindow;
let backend;
let collector;
let collectorMode = '';
let dashboardUrl = '';

function resource(name) {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), name);
}

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureStarterArchive() {
  const destination = dataDir();
  const database = path.join(destination, 'reviews.sqlite3');
  const seed = resource(path.join('seed', 'reviews.sqlite3.gz'));
  if (fs.existsSync(database) || !fs.existsSync(seed)) return;
  const temporary = database + '.tmp';
  try {
    fs.writeFileSync(temporary, zlib.gunzipSync(fs.readFileSync(seed)));
    fs.renameSync(temporary, database);
    const report = resource(path.join('seed', 'scrape-report.json'));
    if (fs.existsSync(report)) fs.copyFileSync(report, path.join(destination, 'scrape-report.json'));
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    send('app-error', `Could not install starter archive: ${error.message}`);
  }
}

function childEnv() {
  const env = {
    ...process.env,
    GYM_DATA_DIR: dataDir(),
    GYM_DIRECTORY_FILE: resource('gyms_lt.json'),
    GYM_PLACES_FILE: resource('verified_maps_places.json'),
  };
  if (app.isPackaged) {
    env.GYM_REVIEW_APP_EXE = resource(path.join('backend', 'review_app.exe'));
    env.PLAYWRIGHT_BROWSERS_PATH = resource('browsers');
  }
  return env;
}

function backendCommand(args) {
  if (app.isPackaged) return { executable: resource(path.join('backend', 'review_app.exe')), args };
  return { executable: process.platform === 'win32' ? 'python' : 'python3',
    args: [resource('review_app.py'), ...args] };
}

function send(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380, height: 950, minWidth: 850, minHeight: 650,
    title: 'Lithuanian Gym Reviews',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function startBackend() {
  const command = backendCommand(['serve', '--port', '0']);
  backend = spawn(command.executable, command.args, { env: childEnv(), windowsHide: true });
  let buffer = '';
  backend.stdout.on('data', chunk => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('SERVER_URL=')) {
        dashboardUrl = line.slice('SERVER_URL='.length);
        send('dashboard-ready', dashboardUrl);
      } else if (line) send('app-log', line);
    }
  });
  backend.stderr.on('data', chunk => send('app-log', chunk.toString().trim()));
  backend.on('error', error => send('app-error', `Dashboard failed to start: ${error.message}`));
  backend.on('exit', code => {
    dashboardUrl = '';
    if (mainWindow && !mainWindow.isDestroyed()) send('app-error', `Dashboard stopped (exit ${code}). Restart the app.`);
  });
}

function startCollector(mode) {
  if (collector) return { ok: false, message: 'A collection or sign-in is already running.' };
  const stopFile = path.join(dataDir(), 'stop-requested');
  fs.rmSync(stopFile, { force: true });
  const args = mode === 'login' ? ['login'] :
    mode === 'refresh' ? ['run', '--all', '--retry', '--incremental'] : ['run', '--all'];
  const env = { ...childEnv(), ELECTRON_RUN_AS_NODE: '1', GYM_STOP_FILE: stopFile };
  collectorMode = mode;
  collector = spawn(process.execPath, [path.join(app.getAppPath(), 'maps_scraper.js'), ...args], {
    env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  send('collector-status', { running: true, mode });
  collector.stdout.on('data', chunk => send('app-log', chunk.toString()));
  collector.stderr.on('data', chunk => send('app-log', chunk.toString()));
  collector.on('error', error => send('app-error', `Collector failed: ${error.message}`));
  collector.on('exit', code => {
    send('app-log', `Collector finished (exit ${code}).`);
    collector = null;
    collectorMode = '';
    fs.rmSync(stopFile, { force: true });
    send('collector-status', { running: false, mode: '' });
    send('reload-dashboard');
  });
  return { ok: true };
}

ipcMain.handle('dashboard-url', () => dashboardUrl);
ipcMain.handle('collector-start', (_event, mode) => {
  if (!['missing', 'refresh', 'login'].includes(mode)) return { ok: false, message: 'Invalid action.' };
  return startCollector(mode);
});
ipcMain.handle('collector-finish-login', () => {
  if (collectorMode !== 'login' || !collector) return { ok: false };
  collector.stdin.write('\n');
  return { ok: true };
});
ipcMain.handle('collector-stop', () => {
  if (!collector || collectorMode === 'login') return { ok: false };
  fs.writeFileSync(path.join(dataDir(), 'stop-requested'), '1');
  return { ok: true };
});
ipcMain.handle('open-data-folder', () => shell.openPath(dataDir()));
ipcMain.handle('import-csv', async () => {
  if (collector) return { ok: false, message: 'Wait until collection finishes.' };
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Import reviews CSV', properties: ['openFile'],
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  });
  if (selection.canceled || !selection.filePaths.length) return { ok: false, canceled: true };
  const command = backendCommand(['import-csv', selection.filePaths[0]]);
  return await new Promise(resolve => {
    const child = spawn(command.executable, command.args, { env: childEnv(), windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('error', error => resolve({ ok: false, message: error.message }));
    child.on('exit', code => {
      if (code === 0) send('reload-dashboard');
      resolve({ ok: code === 0, message: output.trim() });
    });
  });
});

app.whenReady().then(() => {
  createWindow();
  ensureStarterArchive();
  startBackend();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (collector) collector.kill();
  if (backend) backend.kill();
});
