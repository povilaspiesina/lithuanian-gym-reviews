const $ = id => document.getElementById(id);
let running = false;
let mode = '';

function setControls() {
  for (const id of ['collect', 'refresh', 'login', 'import', 'folder']) {
    $(id).disabled = running || !$('dashboard').src;
  }
  $('finish-login').hidden = !running || mode !== 'login';
  $('stop').hidden = !running || mode === 'login';
  $('status').textContent = running ? (mode === 'login' ? 'Sign in to Maps in the collector window' : 'Collecting reviews…') : 'Ready';
}
function appendLog(message) {
  $('activity').hidden = false;
  const log = $('log');
  log.textContent += message.endsWith('\n') ? message : message + '\n';
  if (log.textContent.length > 30000) log.textContent = log.textContent.slice(-20000);
  log.scrollTop = log.scrollHeight;
}
function dashboardReady(url) {
  $('dashboard').src = url;
  $('dashboard').hidden = false;
  $('loading').hidden = true;
  setControls();
}
async function start(mode) {
  const result = await window.gymApp.start(mode);
  if (!result.ok) appendLog(result.message);
}

$('collect').onclick = () => start('missing');
$('refresh').onclick = () => start('refresh');
$('login').onclick = () => start('login');
$('finish-login').onclick = () => window.gymApp.finishLogin();
$('stop').onclick = async () => {
  await window.gymApp.stop();
  appendLog('Stop requested. The collector will save this club, then stop.');
};
$('folder').onclick = () => window.gymApp.openDataFolder();
$('import').onclick = async () => {
  const result = await window.gymApp.importCsv();
  if (!result.canceled) appendLog(result.message || (result.ok ? 'Imported CSV.' : 'Import failed.'));
};
window.gymApp.on('dashboard-ready', dashboardReady);
window.gymApp.on('collector-status', state => { running = state.running; mode = state.mode; setControls(); });
window.gymApp.on('app-log', appendLog);
window.gymApp.on('app-error', message => { appendLog(message); $('status').textContent = 'Error'; });
window.gymApp.on('reload-dashboard', () => { if ($('dashboard').src) $('dashboard').contentWindow.location.reload(); });
window.gymApp.dashboardUrl().then(url => { if (url) dashboardReady(url); });
