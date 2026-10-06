const $ = id => document.getElementById(id);
let running = false;
let mode = '';
let setupShown = false;
let issueCount = 0;

function setControls() {
  for (const id of ['collect', 'refresh', 'login', 'import', 'folder', 'hf-token']) {
    $(id).disabled = running || !$('dashboard').src;
  }
  $('finish-login').hidden = !running || mode !== 'login';
  $('stop').hidden = !running || mode === 'login';
  $('status').textContent = running ? (mode === 'login' ? 'Sign in to Maps in the collector window' : 'Collecting reviews…') : 'Ready';
}
function appendLog(message) {
  message = String(message).replace(/\x1b\[[0-9;]*m/g, '');
  const log = $('log');
  log.textContent += message.endsWith('\n') ? message : message + '\n';
  if (log.textContent.length > 30000) log.textContent = log.textContent.slice(-20000);
  log.scrollTop = log.scrollHeight;
  const line = message.trim().split('\n').filter(Boolean).at(-1) || 'Activity available';
  if (/error|failed|timeout|unavailable|no review cards/i.test(message)) issueCount++;
  $('activity-summary').textContent = `${issueCount ? `${issueCount} issue messages · ` : ''}${line.slice(0, 95)}`;
}
function dashboardReady(url) {
  $('dashboard').src = url;
  $('dashboard').hidden = false;
  $('loading').hidden = true;
  setControls();
  if (!setupShown) {
    setupShown = true;
    window.gymApp.setup().then(info => {
      $('collector-size').value = info.collectorSize;
      if (info.needsSignIn) $('signin-dialog').showModal();
    });
  }
}
async function start(mode) {
  const result = await window.gymApp.start(mode);
  if (result.needsSignIn) $('signin-dialog').showModal();
  else if (!result.ok) appendLog(result.message);
}

$('collect').onclick = () => start('missing');
$('refresh').onclick = () => start('refresh');
$('login').onclick = () => start('login');
$('finish-login').onclick = async () => {
  const result = await window.gymApp.finishLogin();
  if (result.ok) appendLog('Maps sign-in confirmed. You can now collect or refresh reviews.');
};
$('signin-now').onclick = () => { $('signin-dialog').close(); start('login'); };
$('signin-later').onclick = () => $('signin-dialog').close();
$('collector-size').onchange = async () => {
  const result = await window.gymApp.setCollectorSize($('collector-size').value);
  if (!result.ok) appendLog(result.message);
  else appendLog('Collector size saved for the next browser window. You can also drag its edges while it is open.');
};
$('hf-token').onclick = () => { $('token-input').value = ''; $('token-message').textContent = ''; $('token-dialog').showModal(); };
$('token-cancel').onclick = () => $('token-dialog').close();
$('token-save').onclick = async () => {
  const result = await window.gymApp.setToken($('token-input').value.trim());
  $('token-message').textContent = result.message;
  if (result.ok) { $('token-input').value = ''; $('token-dialog').close(); appendLog(result.message); }
};
$('token-remove').onclick = async () => {
  const result = await window.gymApp.setToken('');
  $('token-message').textContent = result.message;
  if (result.ok) { $('token-dialog').close(); appendLog(result.message); }
};
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
window.gymApp.on('data-summary', data => {
  const coverage = data.coverage;
  const date = coverage.last_imported;
  const when = date ? new Date(date).toLocaleString() : 'unknown';
  $('data-status').textContent = `${data.review_count.toLocaleString()} reviews · ${coverage.complete}/${coverage.open} clubs complete · ${coverage.missing_known.toLocaleString()} known missing · ${coverage.failed} errors · updated ${when}`;
});
window.gymApp.on('reload-dashboard', () => { if ($('dashboard').src) $('dashboard').contentWindow.location.reload(); });
window.gymApp.dashboardUrl().then(url => { if (url) dashboardReady(url); });
