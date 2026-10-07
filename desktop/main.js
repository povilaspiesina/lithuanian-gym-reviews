const { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const zlib = require('zlib');
const updater = require('./updater');

let mainWindow;
let backend;
let collector;
let collectorMode = '';
let dashboardUrl = '';
const collectorSizes = { compact: '1050,720', medium: '1400,900', large: '1800,1050' };

function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function settings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function saveSettings(value) { fs.writeFileSync(settingsFile(), JSON.stringify({ ...settings(), ...value }, null, 2)); }
function tokenFile() { return path.join(app.getPath('userData'), 'hf-token.enc'); }
function hfToken() {
  try { return safeStorage.decryptString(fs.readFileSync(tokenFile())); } catch { return ''; }
}
function signedInOnce() { return Boolean(settings().mapsSignInConfirmed); }

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
    GYM_BROWSER_SIZE: collectorSizes[settings().collectorSize] || collectorSizes.medium,
    HF_TOKEN: hfToken(),
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
  const previous = backend;
  const child = spawn(command.executable, command.args, { env: childEnv(), windowsHide: true });
  backend = child;
  dashboardUrl = '';
  if (previous) previous.kill();
  let buffer = '';
  child.stdout.on('data', chunk => {
    if (backend !== child) return;
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('SERVER_URL=')) {
        dashboardUrl = line.slice('SERVER_URL='.length);
        send('dashboard-ready', dashboardUrl);
        refreshDataSummary();
      } else if (line) send('app-log', line);
    }
  });
  child.stderr.on('data', chunk => send('app-log', chunk.toString().trim()));
  child.on('error', error => send('app-error', `Dashboard failed to start: ${error.message}`));
  child.on('exit', code => {
    if (backend !== child) return;
    dashboardUrl = '';
    if (mainWindow && !mainWindow.isDestroyed()) send('app-error', `Dashboard stopped (exit ${code}). Restart the app.`);
  });
}

async function refreshDataSummary() {
  if (!dashboardUrl) return;
  try {
    const response = await fetch(dashboardUrl + '/api/status');
    if (!response.ok) return;
    send('data-summary', await response.json());
  } catch { /* The backend may still be starting or shutting down. */ }
}

function startCollector(mode, clubId = '', clubIds = []) {
  if (collector) return { ok: false, message: 'A collection or sign-in is already running.' };
  if (mode !== 'login' && !signedInOnce()) {
    return { ok: false, needsSignIn: true, message: 'Sign in to Google Maps before collecting.' };
  }
  const stopFile = path.join(dataDir(), 'stop-requested');
  fs.rmSync(stopFile, { force: true });
  const args = mode === 'login' ? ['login'] :
    mode === 'refresh' ? ['run', '--all', '--retry', '--incremental'] :
    mode === 'club' ? ['run', '--club', clubId, '--retry'] :
    mode === 'attention' ? ['run', '--clubs', clubIds.join(',')] : ['run', '--all'];
  const env = { ...childEnv(), ELECTRON_RUN_AS_NODE: '1', GYM_STOP_FILE: stopFile };
  delete env.HF_TOKEN;
  collectorMode = mode;
  collector = spawn(process.execPath, [path.join(app.getAppPath(), 'maps_scraper.js'), ...args], {
    env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  send('collector-status', { running: true, mode });
  let progressBuffer = '';
  collector.stdout.on('data', chunk => {
    const output = chunk.toString();
    send('app-log', output);
    progressBuffer += output;
    const lines = progressBuffer.split(/\r?\n/);
    progressBuffer = lines.pop().slice(-300);
    for (const line of lines) {
      if (line.startsWith('COLLECTOR_CLUB=')) send('collector-progress', {clubId: line.slice(15)});
    }
  });
  collector.stderr.on('data', chunk => send('app-log', chunk.toString()));
  collector.on('error', error => send('app-error', `Collector failed: ${error.message}`));
  collector.on('exit', code => {
    send('app-log', `Collector finished (exit ${code}).`);
    collector = null;
    collectorMode = '';
    fs.rmSync(stopFile, { force: true });
    send('collector-status', { running: false, mode: '' });
    send('collector-progress', {clubId: ''});
    send('reload-dashboard');
    refreshDataSummary();
  });
  return { ok: true };
}

ipcMain.handle('dashboard-url', () => dashboardUrl);
ipcMain.handle('collector-start', async (_event, request) => {
  const mode = typeof request === 'string' ? request : request?.mode;
  const clubId = typeof request === 'object' ? request?.clubId : '';
  const clubIds = typeof request === 'object' ? request?.clubIds : undefined;
  if (!['missing', 'attention', 'refresh', 'login', 'club'].includes(mode)) return { ok: false, message: 'Invalid action.' };
  if (mode === 'missing') {
    try {
      const response = await fetch(dashboardUrl + '/api/status');
      if (!response.ok) throw new Error('Could not read collection status');
      const coverage = (await response.json()).coverage;
      const ids = Object.entries(coverage.clubs).filter(([, entry]) => !entry.complete).map(([id]) => id);
      if (!ids.length) return { ok: false, message: 'All open clubs have verified counts and full saved text.' };
      return startCollector('attention', '', ids);
    } catch (error) { return { ok: false, message: error.message }; }
  }
  if (mode === 'club' || mode === 'attention') {
    const directory = JSON.parse(fs.readFileSync(resource('gyms_lt.json'), 'utf8'));
    const openIds = new Set(directory.clubs.filter(club => club.status === 'open').map(club => club.id));
    if (mode === 'club' && !openIds.has(clubId)) return { ok: false, message: 'Invalid club.' };
    if (mode === 'attention' && (!Array.isArray(clubIds) || !clubIds.length || clubIds.length > openIds.size ||
      clubIds.some(id => !openIds.has(id)) || new Set(clubIds).size !== clubIds.length)) return { ok: false, message: 'Invalid club selection.' };
  }
  return startCollector(mode, clubId, clubIds);
});
ipcMain.handle('collector-finish-login', () => {
  if (collectorMode !== 'login' || !collector) return { ok: false };
  saveSettings({ mapsSignInConfirmed: true });
  collector.stdin.write('\n');
  return { ok: true };
});
ipcMain.handle('setup-status', () => ({ needsSignIn: !signedInOnce(), tokenConfigured: Boolean(hfToken()),
  updatesSupported: app.isPackaged && process.platform === 'win32',
  collectorSize: settings().collectorSize || 'medium' }));
let updateCheckRunning = false;
ipcMain.handle('check-updates', async (_event, manual = false) => {
  if (process.platform !== 'win32' || !app.isPackaged) return { ok: false, message: 'In-app installation is available in the packaged Windows app.' };
  if (updateCheckRunning) return { ok: false, message: 'An update check is already running.' };
  updateCheckRunning = true;
  try {
    const release = await updater.latestRelease();
    const asset = updater.installerFor(release);
    if (!asset || !updater.newerVersion(asset.version, app.getVersion())) {
      return { ok: true, message: manual ? `Version ${app.getVersion()} is up to date.` : '' };
    }
    if (collector) return { ok: false, message: `Version ${asset.version} is available. Finish collecting before updating.` };
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'App update available',
      message: `Lithuanian Gym Reviews ${asset.version} is available`,
      detail: `Current version: ${app.getVersion()}. Download and open the verified installer now? Your saved reviews remain in the app data folder.`,
      buttons: ['Download and install', 'Later'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (choice.response !== 0) return { ok: true, message: 'Update postponed.' };
    send('update-status', `Downloading version ${asset.version}…`);
    const destination = path.join(app.getPath('userData'), 'updates', asset.name);
    const installer = await updater.downloadInstaller(asset, destination);
    send('update-status', 'Opening installer…');
    const launchError = await shell.openPath(installer);
    if (launchError) throw new Error(`Could not open installer: ${launchError}`);
    app.quit();
    return { ok: true, message: 'Installer opened.' };
  } catch (error) {
    return { ok: false, message: error.message };
  } finally { updateCheckRunning = false; }
});
ipcMain.handle('collector-size', (_event, size) => {
  if (!collectorSizes[size]) return { ok: false, message: 'Invalid collector size.' };
  saveSettings({ collectorSize: size });
  return { ok: true };
});
ipcMain.handle('hf-set-token', (_event, token) => {
  if (collector) return { ok: false, message: 'Wait until collection finishes before changing the token.' };
  if (typeof token !== 'string' || token.length > 300) return { ok: false, message: 'Invalid token.' };
  if (token && !/^hf_[A-Za-z0-9_-]+$/.test(token)) return { ok: false, message: 'Use a Hugging Face token beginning with hf_.' };
  if (token && !safeStorage.isEncryptionAvailable()) return { ok: false, message: 'Secure token storage is unavailable on this computer.' };
  try {
    if (token) fs.writeFileSync(tokenFile(), safeStorage.encryptString(token), { mode: 0o600 });
    else fs.rmSync(tokenFile(), { force: true });
    startBackend();
    return { ok: true, message: token ? 'Token saved securely.' : 'Token removed.' };
  } catch (error) {
    return { ok: false, message: `Could not save token: ${error.message}` };
  }
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
      if (code === 0) refreshDataSummary();
      resolve({ ok: code === 0, message: output.trim() });
    });
  });
});

app.whenReady().then(() => {
  // Older private-repository builds stored a token that public updates no longer need.
  try { fs.rmSync(path.join(app.getPath('userData'), 'github-token.enc'), { force: true }); } catch { /* No update credentials are used. */ }
  createWindow();
  ensureStarterArchive();
  startBackend();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (collector) collector.kill();
  if (backend) backend.kill();
});
