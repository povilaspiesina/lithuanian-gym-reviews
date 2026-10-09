const $ = id => document.getElementById(id);
let running = false;
let mode = '';
let setupShown = false;
let issueCount = 0;
let updateOnStartup = false;
let updateCheckPending = false;

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
      $('check-updates').hidden = !info.updatesSupported;
      updateOnStartup = info.updatesSupported;
      if (updateOnStartup) setInterval(() => checkUpdates(false), 12 * 60 * 60 * 1000);
      if (info.needsSignIn) $('signin-dialog').showModal();
      else if (updateOnStartup) checkUpdates(false);
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
$('settings-open').onclick = () => $('settings-dialog').showModal();
$('settings-close').onclick = () => $('settings-dialog').close();
$('settings-dialog').onclick = event => { if (event.target === $('settings-dialog')) $('settings-dialog').close(); };
$('login').onclick = () => { $('settings-dialog').close(); start('login'); };
$('finish-login').onclick = async () => {
  const result = await window.gymApp.finishLogin();
  if (result.ok) appendLog('Maps sign-in confirmed. You can now collect or refresh reviews.');
  if (result.ok && updateOnStartup) checkUpdates(false);
};
$('signin-now').onclick = () => { $('signin-dialog').close(); start('login'); };
$('signin-later').onclick = () => {
  $('signin-dialog').close();
  if (updateOnStartup) checkUpdates(false);
};
async function checkUpdates(manual) {
  if (updateCheckPending) {
    if (manual) {
      $('update-message').textContent = 'An update check is already running. Results will appear here shortly.';
      if (!$('update-dialog').open) $('update-dialog').show();
    }
    return;
  }
  updateCheckPending = true;
  $('status').textContent = 'Checking for updates…';
  if (manual) {
    $('update-title').textContent = 'Checking for updates';
    $('update-message').textContent = 'Connecting to GitHub releases…';
    $('update-progress').hidden = false;
    if (!$('update-dialog').open) $('update-dialog').show();
  }
  try {
    const result = await window.gymApp.checkUpdates(manual);
    if (result.message) appendLog(result.message);
    if ($('update-dialog').open) {
      $('update-title').textContent = result.ok ? 'Update check complete' : 'Update check could not finish';
      $('update-message').textContent = result.message || 'Update check complete.';
      $('update-progress').hidden = true;
    }
  } catch (error) {
    appendLog(`Update check failed: ${error.message}`);
    if ($('update-dialog').open) {
      $('update-title').textContent = 'Update check could not finish';
      $('update-message').textContent = error.message;
      $('update-progress').hidden = true;
    }
  } finally { updateCheckPending = false; if (!running) $('status').textContent = 'Ready'; }
}
$('check-updates').onclick = () => { $('settings-dialog').close(); checkUpdates(true); };
$('update-close').onclick = () => $('update-dialog').close();
$('collector-size').onchange = async () => {
  const result = await window.gymApp.setCollectorSize($('collector-size').value);
  if (!result.ok) appendLog(result.message);
  else appendLog('Collector size saved for the next browser window. You can also drag its edges while it is open.');
};
$('hf-token').onclick = () => { $('settings-dialog').close(); $('token-input').value = ''; $('token-message').textContent = ''; $('token-dialog').showModal(); };
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
$('folder').onclick = () => { $('settings-dialog').close(); window.gymApp.openDataFolder(); };
$('import').onclick = async () => {
  $('settings-dialog').close();
  const result = await window.gymApp.importCsv();
  if (!result.canceled) appendLog(result.message || (result.ok ? 'Imported CSV.' : 'Import failed.'));
};
window.gymApp.on('dashboard-ready', dashboardReady);
window.gymApp.on('collector-status', state => { running = state.running; mode = state.mode; setControls(); });
window.gymApp.on('collector-progress', state => {
  if ($('dashboard').src) $('dashboard').contentWindow.postMessage({type:'gym-collector-progress', clubId: state.clubId}, new URL($('dashboard').src).origin);
});
window.gymApp.on('app-log', appendLog);
window.gymApp.on('app-error', message => { appendLog(message); $('status').textContent = 'Error'; });
window.gymApp.on('update-status', message => {
  $('status').textContent = message;
  if ($('update-dialog').open) {
    $('update-title').textContent = 'Updating app';
    $('update-message').textContent = message;
    const match = message.match(/(\d+)%/);
    if (match) { $('update-progress').max = 100; $('update-progress').value = Number(match[1]); }
    else $('update-progress').removeAttribute('value');
    $('update-progress').hidden = false;
  }
});
window.gymApp.on('data-summary', data => {
  const coverage = data.coverage;
  const date = coverage.last_imported;
  const when = date ? new Date(date).toLocaleDateString() : 'unknown';
  $('data-status').textContent = `${data.review_count.toLocaleString()} reviews · ${coverage.complete}/${coverage.open} clubs complete · updated ${when}`;
});
window.gymApp.on('reload-dashboard', () => { if ($('dashboard').src) $('dashboard').contentWindow.location.reload(); });
window.addEventListener('message', async event => {
  if (event.source !== $('dashboard').contentWindow || event.origin !== new URL($('dashboard').src).origin) return;
  if (event.data?.type !== 'gym-collector-start') return;
  const result = await window.gymApp.start({ mode: event.data.mode, clubId: event.data.clubId, clubIds: event.data.clubIds });
  if (result.needsSignIn) $('signin-dialog').showModal();
  $('dashboard').contentWindow.postMessage({type:'gym-collector-result', ok: Boolean(result.ok),
    message: result.ok ? 'Collection started. The table will update as clubs finish.' : result.message}, event.origin);
});
window.gymApp.dashboardUrl().then(url => { if (url) dashboardReady(url); });
