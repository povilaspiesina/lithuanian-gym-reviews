const clubs = JSON.parse(document.getElementById('club-directory').textContent);
const byId = new Map(clubs.map(c => [c.id, c]));
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '—';
const fmt = n => Number(n).toLocaleString();
let overviewData = null, reviewData = null, collectionData = null, reviewOffset = 0;
let activeClubId = '';
let sortKey = 'count', sortDescending = true;
let savedPrompts = [];
let activeView = 'overview';
let cancelAnalysis = false;
let comparisonRequest = 0;
let overviewRequest = 0;
let comparisonData = null, selectedComparisonIndex = null;
const chainNames = [...new Set(clubs.map(club => club.chain))].sort();
let selectedScopes = new Set(chainNames.map(chain => `chain:${chain}`));
let showAverage = false;
const logoPaths = {'Gym+':'/assets/gym-plus.svg','Lemon Gym':'/assets/lemon-gym.svg','SportGates':'/assets/sportgates.png'};
function brandLogo(chain) {
  if (!logoPaths[chain]) return `<span class="brand-symbol" aria-hidden="true">AVG</span>`;
  return `<span class="brand-mark brand-${chain === 'Gym+' ? 'gym' : chain === 'Lemon Gym' ? 'lemon' : 'sport'}"><img src="${logoPaths[chain]}" alt="" loading="lazy"></span>`;
}
function seriesLogo(item) {
  const chain = item.key.startsWith('chain:') ? item.key.slice(6) : item.key.startsWith('club:') ? byId.get(item.key.slice(5))?.chain : '';
  return chain ? brandLogo(chain) : '<span class="brand-symbol" aria-hidden="true">AVG</span>';
}
const aiPresets = {
  issues: {mode:'issues', prompt:'Identify up to five distinct recurring problems. For each, explain the customer experience in plain English and cite one or two specific comments using their [R#] references. Merge overlapping themes. Distinguish repeated reports from isolated ones and make no claims beyond these comments.'},
  actions: {mode:'issues', prompt:'Recommend up to three practical gym improvements supported by these comments. For each, state the customer problem, a concrete action, and a specific comment with its [R#] reference. Do not repeat the same issue under different headings. Say when evidence is sparse.'},
  billing: {mode:'issues', prompt:'Examine only comments about membership terms, cancellation, charges, and billing. Group distinct issues and support each with a relevant comment and [R#] reference. Exclude unrelated complaints. If no comment is relevant, say so. Make no legal conclusions.'},
  strengths: {mode:'summary', prompt:'Identify the main positive themes without duplication. Support each with a relevant comment and [R#] reference. Distinguish repeated praise from one-off comments.'},
  replies: {mode:'summary', prompt:'Assess only comments with owner replies. Separate specific responses from generic or unresolved ones. For each finding, cite a relevant comment and its owner reply using its [R#] reference. Do not judge comments without replies as answered.'},
  recent: {mode:'summary', prompt:'Summarize distinct positive and negative themes in the selected date period. Support each with a relevant comment and [R#] reference. Google Maps dates may be estimated; do not claim a trend from this sample alone.'},
  compare: {mode:'summary', prompt:'Compare the represented chains or clubs only where comments support a difference. Give specific comments with [R#] references for each comparison. Avoid generalizing from sparse comments.'},
  brief: {mode:'summary', prompt:'Write a concise management brief: strengths, recurring problems, owner response gaps, and up to two next actions. Use specific comments and [R#] references for substantive claims. Merge overlapping points and stay within these comments.'},
  question: {mode:'question', prompt:''},
};
const presetDetails = {
  issues:['Recurring problems (1–3 ★)','Find repeated complaints and cite evidence.'],
  actions:['Practical fixes (1–3 ★)','Turn negative feedback into concrete actions.'],
  billing:['Membership and billing (1–3 ★)','Focus on contracts, cancellation and charges.'],
  strengths:['What members value','Summarize positive feedback.'],
  replies:['Owner reply quality','Assess how clubs respond to concerns.'],
  recent:['Recent changes','Summarize the selected date period.'],
  compare:['Compare selected clubs','Contrast chains or clubs in the filtered reviews.'],
  brief:['Management brief','Create a short decision-ready summary.'],
  question:['New blank prompt','Write your own question about the selected reviews.'],
};

function selectedPreset() {
  const key = $('#ai-mode').value;
  return key.startsWith('saved:') ? savedPrompts.find(item => item.id === key.slice(6)) : aiPresets[key];
}
function renderPromptChoices(selected = 'issues') {
  const options = Object.entries(presetDetails).map(([key, [name]]) => `<option value="${key}">${esc(name)}</option>`).join('');
  const saved = savedPrompts.map(item => `<option value="saved:${esc(item.id)}">${esc(item.name)}</option>`).join('');
  $('#ai-mode').innerHTML = `<optgroup label="Built-in examples">${options}</optgroup><optgroup label="My saved prompts">${saved || '<option disabled>No saved prompts yet</option>'}</optgroup>`;
  $('#ai-mode').value = selected;
  if (!$('#ai-mode').value) $('#ai-mode').value = 'issues';
  selectPrompt();
}
function selectPrompt() {
  const key = $('#ai-mode').value;
  const item = selectedPreset();
  if (!item) return;
  const saved = key.startsWith('saved:');
  $('#prompt-name').value = saved ? item.name : key === 'question' ? '' : presetDetails[key][0];
  $('#ai-question').value = item.prompt;
  $('#prompt-description').textContent = saved ? 'Your saved prompt. Edit its name or instructions, then save the changes.' : presetDetails[key][1];
  $('#prompt-save').textContent = saved ? 'Save changes' : 'Save as new';
  $('#prompt-copy').hidden = !saved;
  $('#prompt-delete').hidden = !saved;
  $('#prompt-status').textContent = saved ? 'Saved on this computer in the review archive.' : 'Built-in example. Edit and save it under your own name.';
}
async function loadPrompts() {
  try {
    const response = await fetch('/api/prompts');
    if (!response.ok) throw new Error('Could not load saved prompts');
    savedPrompts = await response.json();
    renderPromptChoices();
  } catch (error) { $('#prompt-status').textContent = error.message; }
}
async function savePrompt(copy = false) {
  const key = $('#ai-mode').value;
  const item = selectedPreset();
  const body = {action:'save', name:$('#prompt-name').value.trim(), prompt:$('#ai-question').value.trim(),
    mode:item?.mode || 'question', id:key.startsWith('saved:') && !copy ? key.slice(6) : ''};
  try {
    const response = await fetch('/api/prompts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save prompt');
    savedPrompts = savedPrompts.filter(prompt => prompt.id !== result.id).concat(result).sort((a,b) => a.name.localeCompare(b.name));
    renderPromptChoices('saved:' + result.id);
    $('#prompt-status').textContent = 'Prompt saved in the local review archive.';
  } catch (error) { $('#prompt-status').textContent = error.message; }
}
async function deletePrompt() {
  const key = $('#ai-mode').value;
  if (!key.startsWith('saved:') || !confirm('Delete this saved prompt?')) return;
  try {
    const response = await fetch('/api/prompts', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'delete', id:key.slice(6)})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete prompt');
    savedPrompts = savedPrompts.filter(item => item.id !== result.deleted);
    renderPromptChoices();
    $('#prompt-status').textContent = 'Saved prompt deleted.';
  } catch (error) { $('#prompt-status').textContent = error.message; }
}

function filterFields(includePeriod = true) {
  const choices = (items, label) => `<option value="">All ${label}</option>` + items.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  const cities = [...new Set(clubs.map(c => c.locality))].sort();
  return `
    ${includePeriod ? `<div class="filter-time"><label>Period<select name="period"><option value="all">All time</option><option value="last_30_days">Last 30 days</option><option value="previous_month">Previous month</option><option value="custom">Custom dates</option></select></label>
      <div class="date-slot"><div class="date-fields" aria-hidden="true"><label>From<input type="date" name="start" disabled></label><label>To<input type="date" name="end" disabled></label></div><p class="date-hint">Choose Custom dates to set a range.</p></div></div>` : ''}
    <div class="scope-picker"><div class="scope-head"><strong>Compare gyms</strong><span class="scope-status"></span></div>
      <div class="scope-actions"><button type="button" data-scopes-action="all">All chains</button><button type="button" data-scopes-action="clear">Clear selection</button></div>
      <div class="scope-chains">${chainNames.map(chain => `<label class="scope-chip"><input type="checkbox" data-scope="chain:${esc(chain)}"> ${brandLogo(chain)} ${esc(chain)}</label>`).join('')}</div>
      <details class="scope-clubs"><summary>Choose individual clubs</summary><input type="search" class="club-search" placeholder="Find a club or city" aria-label="Find a club or city"><div class="club-options">${clubs.filter(club => club.status === 'open').map(club => `<label class="club-option" data-search="${esc(`${club.chain} ${club.club_name} ${club.locality}`.toLowerCase())}"><input type="checkbox" data-scope="club:${esc(club.id)}">${brandLogo(club.chain)}<span>${esc(club.chain)} · ${esc(club.club_name)}<small>${esc(club.locality)}</small></span></label>`).join('')}</div></details>
      <label class="average-option"><input type="checkbox" data-average> Compare with average gym <span>(each chain has equal weight)</span></label>
    </div>
    <div class="filter-main">
    <label>City<select name="city">${choices(cities, 'cities')}</select></label>
    <label>Stars<select name="rating"><option value="">All ratings</option>${[1,2,3,4,5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
    <label>Written comment<select name="comment"><option value="all">All reviews</option><option value="written">With comment</option><option value="rating_only">Rating only</option></select></label>
    <label>Owner reply<select name="reply"><option value="all">All reviews</option><option value="replied">With reply</option><option value="unreplied">Without reply</option></select></label>
    <label>Search text<input name="q" type="search" placeholder="e.g. cleanliness"></label>
    <button type="submit">Apply filters</button></div>`;
}

function tomorrowLocal() {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function renderScopeSelections() {
  for (const id of filterIds) {
    const form = document.getElementById(id);
    for (const checkbox of form.querySelectorAll('[data-scope]')) checkbox.checked = selectedScopes.has(checkbox.dataset.scope);
    form.querySelector('[data-average]').checked = showAverage;
    const chains = [...selectedScopes].filter(scope => scope.startsWith('chain:')).length;
    const clubs = selectedScopes.size - chains;
    const summary = `${chains} chain${chains === 1 ? '' : 's'} · ${clubs} club${clubs === 1 ? '' : 's'} selected${showAverage ? ' · average gym' : ''}`;
    form.querySelector('.scope-status').textContent = summary;
    form.closest('.filter-panel').querySelector('.filter-summary').textContent = summary;
  }
}

const filterIds = ['overview-filters', 'trends-filters', 'review-filters'];
for (const id of filterIds) {
  const form = document.getElementById(id);
  const includePeriod = id !== 'trends-filters';
  form.innerHTML = filterFields(includePeriod);
  if (includePeriod) {
    form.elements.start.max = tomorrowLocal();
    form.elements.end.max = tomorrowLocal();
  }
  const updateDateFields = () => {
    if (!includePeriod) return;
    const active = form.elements.period.value === 'custom';
    form.elements.start.disabled = !active;
    form.elements.end.disabled = !active;
    form.querySelector('.date-slot').classList.toggle('date-active', active);
    form.querySelector('.date-fields').setAttribute('aria-hidden', String(!active));
  };
  form.updateDateFields = updateDateFields;
  form.addEventListener('change', event => {
    const scopeChanged = !!event.target.dataset.scope || event.target.hasAttribute('data-average');
    if (event.target.dataset.scope) {
      if (event.target.checked) selectedScopes.add(event.target.dataset.scope);
      else selectedScopes.delete(event.target.dataset.scope);
      renderScopeSelections();
    } else if (event.target.hasAttribute('data-average')) {
      showAverage = event.target.checked;
      renderScopeSelections();
    }
    updateDateFields(); syncFilters(form);
    if (scopeChanged) {
      if (activeView === 'overview') loadOverview();
      else if (activeView === 'trends') loadPeriodComparison();
      else if (activeView === 'reviews') { reviewOffset = 0; loadReviews(); }
    }
  });
  form.addEventListener('click', event => {
    const action = event.target.closest('[data-scopes-action]')?.dataset.scopesAction;
    if (!action) return;
    selectedScopes = action === 'all' ? new Set(chainNames.map(chain => `chain:${chain}`)) : new Set();
    renderScopeSelections();
    if (activeView === 'overview') loadOverview();
    else if (activeView === 'trends') loadPeriodComparison();
    else if (activeView === 'reviews') { reviewOffset = 0; loadReviews(); }
  });
  form.addEventListener('input', event => {
    if (event.target.matches('.club-search')) {
      const search = event.target.value.trim().toLowerCase();
      for (const option of form.querySelectorAll('.club-option')) option.hidden = !option.dataset.search.includes(search);
    } else if (!event.target.matches('[data-scope]')) syncFilters(form);
  });
  updateDateFields();
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    syncFilters(form);
    if (id === 'overview-filters') loadOverview();
    else if (id === 'trends-filters') loadPeriodComparison();
    else { reviewOffset = 0; loadReviews(); }
  };
}
renderScopeSelections();

function syncFilters(source) {
  for (const id of filterIds) {
    if (id === source.id) continue;
    const destination = document.getElementById(id);
    for (const name of ['period','start','end','city','rating','comment','reply','q']) {
      if (source.elements[name] && destination.elements[name]) destination.elements[name].value = source.elements[name].value;
    }
    destination.updateDateFields();
  }
}

function query(form) {
  const params = new URLSearchParams(new FormData(form));
  if (params.get('period') !== 'custom') { params.delete('start'); params.delete('end'); }
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  for (const scope of selectedScopes) params.append('scope', scope);
  if (!selectedScopes.size) params.append('scope','none');
  if (showAverage && form.id !== 'review-filters') params.set('average','1');
  return params;
}

function tip(text, event) {
  const el = $('#tooltip');
  el.textContent = text;
  el.hidden = false;
  el.style.left = `${Math.min(event.clientX + 14, innerWidth - el.offsetWidth - 12)}px`;
  el.style.top = `${Math.max(8, event.clientY - el.offsetHeight - 12)}px`;
}
document.addEventListener('pointerover', event => {
  const target = event.target.closest('[data-tip]');
  if (target) tip(target.dataset.tip, event);
});
document.addEventListener('pointermove', event => {
  const target = event.target.closest('[data-tip]');
  if (target) tip(target.dataset.tip, event);
});
document.addEventListener('pointerout', event => {
  if (event.target.closest('[data-tip]')) $('#tooltip').hidden = true;
});
document.addEventListener('focusin', event => {
  const target = event.target.closest('[data-tip]');
  if (target) {
    const box = target.getBoundingClientRect();
    tip(target.dataset.tip, {clientX: box.left + box.width / 2, clientY: box.top});
  }
});
document.addEventListener('focusout', event => { if (event.target.closest('[data-tip]')) $('#tooltip').hidden = true; });

function renderPlot(target, rows, metric) {
  const el = $(target);
  if (!rows.length) { el.innerHTML = '<p class="muted">No reviews in this selection.</p>'; return; }
  const width = 480, height = 205, left = 36, right = 15, top = 17, bottom = 31;
  const plotW = width - left - right, plotH = height - top - bottom;
  const max = metric === 'count' ? Math.max(1, ...rows.map(x => x.count)) : 5;
  const x = i => left + (rows.length === 1 ? plotW / 2 : plotW * i / (rows.length - 1));
  const y = n => top + plotH * (1 - n / max);
  const grid = [0, .5, 1].map(f => `<line class="gridline" x1="${left}" x2="${width-right}" y1="${y(max*f)}" y2="${y(max*f)}"/><text class="axis" x="${left-5}" y="${y(max*f)+4}" text-anchor="end">${metric === 'count' ? Math.round(max*f) : (max*f).toFixed(1)}</text>`).join('');
  let marks;
  if (metric === 'count') {
    const barW = Math.max(3, Math.min(30, plotW / rows.length * .72));
    marks = rows.map((row, i) => `<rect class="volume" x="${x(i)-barW/2}" y="${y(row.count)}" width="${barW}" height="${Math.max(0,top+plotH-y(row.count))}" data-tip="${esc(`${row.period}: ${fmt(row.count)} reviews`)}"/>`).join('');
  } else {
    const points = rows.flatMap((row, i) => row.average_rating == null ? [] : [`${x(i)},${y(row.average_rating)}`]);
    marks = (points.length > 1 ? `<polyline class="trend-line" points="${points.join(' ')}"/>` : '') +
      rows.map((row, i) => row.average_rating == null ? '' : `<circle class="plot-dot" tabindex="0" cx="${x(i)}" cy="${y(row.average_rating)}" r="5" data-tip="${esc(`${row.period}: ${row.average_rating} ★ from ${fmt(row.count)} reviews`)}"/>`).join('');
  }
  const labels = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].map(i => `<text class="axis" x="${x(i)}" y="${height-8}" text-anchor="middle">${esc(rows[i].period)}</text>`).join('');
  el.innerHTML = `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric === 'count' ? 'Review volume' : 'Average rating'} by period">${grid}${marks}${labels}</svg>`;
}

function renderCoverage(coverage) {
  $('#coverage').textContent = `${coverage.complete}/${coverage.open}`;
  $('#coverage-note').textContent = `${coverage.attempted} checked · ${coverage.unverified} unverified · ${coverage.failed} errors`;
  $('#missing').textContent = fmt(coverage.missing_known);
  $('#missing-note').textContent = `${coverage.unverified} clubs have no verified Maps count`;
  const imported = coverage.last_imported ? new Date(coverage.last_imported).toLocaleString() : 'unknown';
  const checked = coverage.last_checked ? new Date(coverage.last_checked).toLocaleString() : 'never';
  const label = `Archive updated: ${imported} · Maps checked: ${checked}`;
  $('#overview-updated').textContent = label;
  $('#trends-updated').textContent = label;
  $('#reviews-updated').textContent = label;
  $('#collection-updated').textContent = label;
  const quality = coverage.date_quality || {};
  const estimated = quality.estimated || 0, unknown = quality.unknown || 0;
  $('#overview-quality').textContent = `Across the archive, ${fmt(estimated)} reviews have estimated dates${unknown ? ` and ${fmt(unknown)} have unknown date precision` : ''}. Time charts and date filters use the stored dates.`;
  const entries = clubs.filter(c => c.status === 'open').map(c => ({ club: c, info: coverage.clubs[c.id] || {} }));
  entries.sort((a, b) => Number(a.info.complete) - Number(b.info.complete) || a.club.chain.localeCompare(b.club.chain));
  $('#coverage-list').innerHTML = entries.map(({club, info}) => {
    const count = info.collected || 0;
    const expected = info.displayed_review_count;
    const state = info.state === 'unchecked' ? 'not checked' : info.state === 'error' ? 'error' : info.state === 'shortened' ? `${fmt(info.shortened_count)} shortened` : expected == null ? 'coverage unknown' : info.complete ? 'complete' : `${Math.max(expected-count,0)} missing`;
    const checked = info.scraped_at ? ` · checked ${esc(new Date(info.scraped_at).toLocaleDateString())}` : '';
    return `<div class="coverage-row"><span>${brandLogo(club.chain)}${esc(club.chain)} · ${esc(club.club_name)} · ${esc(club.locality)}${checked}${info.last_error ? ` · ${esc(info.last_error)}` : ''}</span><b>${fmt(count)}/${expected == null ? '?' : fmt(expected)} · ${state}</b></div>`;
  }).join('');
}

function collectionStateLabel(state) {
  return ({complete:'Complete', partial:'Partial', error:'Error', unchecked:'Not checked', unverified:'Coverage unknown', shortened:'Text shortened'})[state] || 'Coverage unknown';
}
function renderCollection(coverage) {
  collectionData = coverage;
  renderCoverage(coverage);
  const states = coverage.states || {};
  $('#collection-progress').max = coverage.open || 1;
  $('#collection-progress').value = states.complete || 0;
  $('#collection-progress-label').textContent = `${fmt(states.complete || 0)} of ${fmt(coverage.open)} open clubs have verified counts and full saved text`;
  if (activeClubId && byId.has(activeClubId)) {
    const club = byId.get(activeClubId);
    $('#collection-progress-label').textContent += ` · Scanning ${club.chain} · ${club.club_name}`;
  }
  $('#collection-state-counts').innerHTML = ['complete','shortened','partial','error','unchecked','unverified'].map(state => `<span class="status-pill ${state}">${collectionStateLabel(state)}: ${fmt(states[state] || 0)}</span>`).join('');
  const filter = $('#collection-filter').value;
  const entries = clubs.filter(c => c.status === 'open').map(club => ({club, info: coverage.clubs[club.id] || {}}))
    .filter(({info}) => filter === 'all' || (filter === 'complete' ? info.state === 'complete' : info.state !== 'complete'))
    .sort((a,b) => (a.info.state === 'complete') - (b.info.state === 'complete') || a.club.chain.localeCompare(b.club.chain) || a.club.club_name.localeCompare(b.club.club_name));
  $('#collection-rows').innerHTML = entries.map(({club,info}) => {
    const expected = info.displayed_review_count;
    const checked = info.scraped_at ? new Date(info.scraped_at).toLocaleString() : 'Never';
    const issues = [info.last_error, info.shortened_count ? `${fmt(info.shortened_count)} shortened reviews or replies` : '',
      info.missing > 0 ? `${fmt(info.missing)} below Maps total` : ''].filter(Boolean);
    const detail = issues.join(' · ') || (info.state === 'unchecked' ? 'No collection recorded' :
      expected == null ? 'Maps total unavailable; completeness cannot be verified' : 'Saved count meets Maps total');
    return `<tr><td><b>${brandLogo(club.chain)}${esc(club.chain)} · ${esc(club.club_name)}</b><div class="subtle">${esc(club.locality)}</div></td><td><span class="status-pill ${club.id === activeClubId ? 'scanning' : esc(info.state)}">${club.id === activeClubId ? 'Scanning' : collectionStateLabel(info.state)}</span></td><td>${fmt(info.collected || 0)} / ${expected == null ? 'Unknown' : fmt(expected)}</td><td>${esc(checked)}</td><td class="collection-detail">${esc(detail)}</td><td><button type="button" class="retry-club" data-retry-club="${esc(club.id)}">${info.state === 'complete' ? 'Refresh' : 'Retry'}</button></td></tr>`;
  }).join('') || '<tr><td colspan="6">No clubs in this view.</td></tr>';
}
async function loadCollection() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('Could not load collection status');
    renderCollection((await response.json()).coverage);
  } catch (error) { $('#collection-action-status').textContent = error.message; }
}
function requestCollection(mode, clubId) {
  if (window.parent === window) {
    $('#collection-action-status').textContent = 'Open the desktop app to run the collector.';
    return;
  }
  const clubIds = mode === 'attention' ? clubs.filter(c => c.status === 'open' && collectionData?.clubs[c.id]?.state !== 'complete').map(c => c.id) : undefined;
  if (mode === 'attention' && !clubIds.length) {
    $('#collection-action-status').textContent = 'All open clubs have verified coverage.';
    return;
  }
  window.parent.postMessage({type:'gym-collector-start', mode, clubId, clubIds}, '*');
  $('#collection-action-status').textContent = 'Starting collection…';
}
window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (event.data?.type === 'gym-collector-progress') {
    activeClubId = event.data.clubId || '';
    if (collectionData) renderCollection(collectionData);
    return;
  }
  if (event.data?.type !== 'gym-collector-result') return;
  $('#collection-action-status').textContent = event.data.message;
  if (event.data.ok) loadCollection();
});

function seriesColor(index, key) {
  if (key === 'average') return '#775ca8';
  const chain = key.startsWith('chain:') ? key.slice(6) : key.startsWith('club:') ? byId.get(key.slice(5))?.chain : '';
  if (key.startsWith('club:')) {
    const variation = [...key].reduce((sum,char) => sum + char.charCodeAt(0),0) % 19 - 9;
    return chain === 'Lemon Gym' ? `hsl(${45 + variation} 85% 39%)` :
      chain === 'Gym+' ? `hsl(${199 + variation} 73% 38%)` : `hsl(${151 + variation} 64% 35%)`;
  }
  return {'Gym+':'#147da7','Lemon Gym':'#d2a300','SportGates':'#168956'}[chain] || '#697d81';
}
function seriesLegend(series) {
  return `<div class="series-legend">${series.map((item,index) => `<span>${seriesLogo(item)}<i style="background:${seriesColor(index,item.key)}"></i>${esc(item.label)}</span>`).join('')}</div>`;
}
function seriesLineChart(target, series, rowsFor, key, maximum, unit) {
  const periods = [...new Set(series.flatMap(item => rowsFor(item).map(row => row.period)))].sort();
  if (!periods.length) { $(target).innerHTML = '<p class="muted">No reviews in this selection.</p>'; return; }
  const width = 720, height = 250, left = 45, right = 22, top = 16, bottom = 42;
  const plotW = width-left-right, plotH = height-top-bottom;
  const x = index => left + (periods.length === 1 ? plotW/2 : plotW*index/(periods.length-1));
  const largest = maximum || Math.max(1,...series.flatMap(item => rowsFor(item).map(row => row[key] || 0))) * 1.1;
  const y = value => top + plotH*(1-value/largest);
  const grid = [0,.5,1].map(f => `<line class="gridline" x1="${left}" x2="${width-right}" y1="${y(largest*f)}" y2="${y(largest*f)}"/><text class="axis" x="${left-6}" y="${y(largest*f)+4}" text-anchor="end">${maximum ? Math.round(largest*f)+unit : Math.round(largest*f)}</text>`).join('');
  const ticks = [...new Set([0,Math.floor((periods.length-1)/2),periods.length-1])].map(i => `<text class="axis" x="${x(i)}" y="${height-9}" text-anchor="${i===0?'start':i===periods.length-1?'end':'middle'}">${esc(periods[i])}</text>`).join('');
  const paths = series.map((item,seriesIndex) => {
    const color = seriesColor(seriesIndex,item.key), rowMap = new Map(rowsFor(item).map(row => [row.period,row]));
    const points = periods.flatMap((period,index) => { const row=rowMap.get(period); return row?.[key] == null ? [] : [`${x(index)},${y(row[key])}`]; });
    const line = points.length > 1 ? `<polyline fill="none" stroke="${color}" stroke-width="3" points="${points.join(' ')}"/>` : '';
    const dots = periods.map((period,index) => { const row=rowMap.get(period); if (row?.[key] == null) return ''; const value = key==='count'?fmt(row[key]):Number(row[key]).toFixed(2)+unit; return `<circle cx="${x(index)}" cy="${y(row[key])}" r="5" fill="${color}" stroke="white" stroke-width="2" tabindex="0" ${target.startsWith('#compare-') ? `data-period-index="${index}"` : ''} data-tip="${esc(`${item.label} · ${period}: ${value} (${fmt(row.count)} reviews)`)}"><title>${esc(`${item.label}: ${value}`)}</title></circle>`; }).join('');
    return line+dots;
  }).join('');
  $(target).innerHTML = seriesLegend(series)+`<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(key.replaceAll('_',' '))} by gym and period">${grid}${paths}${ticks}</svg>`;
}
function renderOverview(data) {
  const series = data.series || [];
  renderCoverage(data.coverage);
  $('#overview-series-cards').innerHTML = series.length ? series.map((item,index) => { const s=item.stats,n=s.review_count,color=seriesColor(index,item.key); return `<section class="card entity-card" style="--entity-color:${color}" data-tip="${esc(`${item.label}: ${fmt(n)} reviews, ${s.average_rating ?? 'no'} average stars`)}" tabindex="0"><h3>${seriesLogo(item)}<i></i>${esc(item.label)}</h3><div class="entity-metrics"><div><small>${item.key==='average'?'Reviews per chain':'Reviews'}</small><b>${fmt(n)}</b></div><div><small>Average ★</small><b>${s.average_rating == null?'—':Number(s.average_rating).toFixed(2)}</b></div><div><small>Written</small><b>${s.written_pct == null ? pct(s.written_count,n) : s.written_pct.toFixed(1)+'%'}</b></div><div><small>1–2 ★</small><b>${s.low_pct == null ? pct(s.low_rating_count,n) : s.low_pct.toFixed(1)+'%'}</b></div><div><small>Owner replies</small><b>${s.reply_pct == null ? pct(s.replied_count,n) : s.reply_pct.toFixed(1)+'%'}</b></div><div><small>Replies to 1–2 ★</small><b>${s.low_reply_pct == null ? pct(s.low_rating_replied_count,s.low_rating_count) : s.low_reply_pct.toFixed(1)+'%'}</b></div></div></section>`; }).join('') : '<p class="muted">Tick at least one chain or club to compare.</p>';
  $('#distribution').innerHTML = series.length ? series.map((item,index) => { const s=item.stats,n=s.review_count; return `<div class="distribution-group"><b style="color:${seriesColor(index,item.key)}">${seriesLogo(item)}${esc(item.label)} · ${fmt(n)} ${item.key==='average'?'per chain':'reviews'}</b>${[5,4,3,2,1].map(star => {const value=s.ratings[String(star)]||0; const share=s.ratings_pct?.[String(star)] ?? (n?100*value/n:0); return `<button type="button" class="distribution-row" data-rating="${star}" data-tip="${esc(`${item.label}: ${star} stars, ${fmt(value)} reviews (${share.toFixed(1)}%)`)}"><span>${star} ★</span><span class="bar-track"><span class="bar-fill" style="width:${share}%;background:${seriesColor(index,item.key)}"></span></span><span>${fmt(value)}</span></button>`;}).join('')}</div>`; }).join('') : '<p class="muted">No selected gyms.</p>';
  $('#trend-note').textContent = `${{day:'Daily',month:'Monthly',year:'Yearly'}[data.grain] || 'Monthly'} totals · some review dates may be estimated`;
  seriesLineChart('#trend',series,item=>item.trend,'count',0,'');
  seriesLineChart('#rating-trend',series,item=>item.trend,'average_rating',5,' ★');
  $('#chains').innerHTML = series.length ? series.map((item,index) => { const s=item.stats, avg=s.average_rating; return `<div class="compare-row" data-tip="${esc(`${item.label}: ${avg ?? 'no'} ★ from ${fmt(s.review_count)} reviews`)}"><b>${seriesLogo(item)}${esc(item.label)}</b><span class="bar-track"><span class="bar-fill" style="width:${avg?100*avg/5:0}%;background:${seriesColor(index,item.key)}"></span></span><span>${avg == null?'—':Number(avg).toFixed(2)+' ★'}</span><span>${fmt(s.review_count)}</span></div>`; }).join('') : '<p class="muted">No selected gyms.</p>';
  renderClubTable();
  const suffix=query($('#overview-filters')).toString();
  for (const link of document.querySelectorAll('[data-export]')) if (link.dataset.export !== 'clubs') link.href=`/export-series.csv?mode=overview&kind=${link.dataset.export}&${suffix}`;
}

function comparisonParams() {
  const params = query($('#trends-filters'));
  params.set('grain', $('#comparison-grain').value);
  return params;
}
function difference(current, previous, suffix, betterDirection) {
  if (current == null || previous == null) return '<span class="muted">—</span>';
  const delta = current - previous;
  const good = delta * betterDirection > 0.005, bad = delta * betterDirection < -0.005;
  const symbol = delta > 0.005 ? '↑' : delta < -0.005 ? '↓' : '→';
  return `<span class="period-delta ${good ? 'improved' : bad ? 'declined' : ''}">${symbol} ${Math.abs(delta).toFixed(suffix === '★' ? 2 : suffix === 'reviews' ? 0 : 1)} ${suffix}</span>`;
}
function renderCurrentChange(data) {
  const windows = data.current_window;
  const grain = {month:'month',quarter:'quarter',year:'year'}[data.grain] || 'period';
  $('#current-change-title').textContent = `${windows.current_label} vs ${windows.previous_label}`;
  $('#current-change-note').textContent = `Last two completed ${grain}s · ${windows.current_label}: ${windows.current_start}–${windows.current_end} · ${windows.previous_label}: ${windows.previous_start}–${windows.previous_end}. Maps dates may be estimated.`;
  const measures = [
    {key:'average_rating',name:'Average rating',unit:'★',better:1,decimals:2},
    {key:'low_pct',name:'1–2 star share',unit:'pp',better:-1,decimals:1},
    {key:'reply_pct',name:'Owner reply rate',unit:'pp',better:1,decimals:1},
    {key:'review_count',name:'Review volume',unit:'reviews',better:1,decimals:1},
  ];
  $('#current-change-panels').innerHTML = measures.map(measure => {
    const available = data.series.map(item => ({item,current:item.current_change.current[measure.key],previous:item.current_change.previous[measure.key]}));
    const max = Math.max(0.01,...available.filter(row => row.current != null && row.previous != null).map(row => Math.abs(row.current-row.previous)));
    const bars = available.map(({item,current,previous},index) => {
      const valid = current != null && previous != null && item.current_change.current.review_count && item.current_change.previous.review_count;
      const delta = valid ? current-previous : null;
      const width = delta == null ? 0 : Math.max(2,45*Math.abs(delta)/max);
      const beneficial = delta == null ? '' : Math.abs(delta)<0.005 ? 'steady' : delta*measure.better>0 ? 'positive' : 'negative';
      const decimals = measure.key === 'review_count' && item.key !== 'average' ? 0 : measure.decimals;
      const label = delta == null ? 'Not enough reviews' : `${delta>0?'↑':delta<0?'↓':'→'} ${Math.abs(delta).toFixed(decimals)} ${measure.unit}`;
      const currentText = current == null ? '—' : Number(current).toFixed(decimals), previousText = previous == null ? '—' : Number(previous).toFixed(decimals);
      const detail = `${item.label}: ${windows.previous_label} ${previousText} → ${windows.current_label} ${currentText} ${measure.unit}`;
      return `<div class="change-row" tabindex="0" data-tip="${esc(detail)}"><span class="change-label">${seriesLogo(item)}${esc(item.label)}</span><span class="change-track"><i class="change-midline"></i>${delta == null ? '' : `<i class="change-bar ${beneficial}" style="left:${delta<0?50-width:50}%;width:${width}%"></i>`}</span><strong class="change-value ${beneficial}">${esc(label)}</strong></div>`;
    }).join('');
    return `<div class="change-panel"><h4>${esc(measure.name)}</h4>${bars || '<p class="muted">Choose a gym or the average gym to compare.</p>'}</div>`;
  }).join('');
}
function renderPeriodComparison(data) {
  const series=data.series || [];
  const periods=[...new Set(series.flatMap(item=>item.rows.map(row=>row.period)))].sort();
  if (selectedComparisonIndex == null || selectedComparisonIndex >= periods.length) selectedComparisonIndex=periods.length-1;
  const current=periods[selectedComparisonIndex], prior=periods[selectedComparisonIndex-1];
  $('#period-details-title').textContent=current ? `Period details · ${current}` : 'Period details';
  $('#period-summary').textContent=current ? `${current} compared with ${prior || 'no preceding period'} · ${series.length} comparison series. Hover a point for exact values and click to inspect another period. Small samples can make changes look dramatic.` : 'No completed periods are available for the selected gyms.';
  const rows=series.map((item,index)=>{ const now=item.rows.find(row=>row.period===current), prev=item.rows.find(row=>row.period===prior); return {item,index,now,prev}; });
  const value=(row,key,suffix='')=>row?.[key]==null?'—':key==='count'?fmt(row[key]):Number(row[key]).toFixed(key==='average_rating'?2:1)+suffix;
  $('#period-rows').innerHTML=rows.map(({item,index,now,prev})=>`<tr><td><span class="series-swatch" style="background:${seriesColor(index,item.key)}"></span>${seriesLogo(item)}${esc(item.label)}</td><td>${value(now,'count')}</td><td>${now&&prev?difference(now.count,prev.count,'reviews',0):'—'}</td><td>${value(now,'average_rating')}</td><td>${now&&prev?difference(now.average_rating,prev.average_rating,'★',1):'—'}</td><td>${value(now,'low_pct','%')}</td><td>${now&&prev?difference(now.low_pct,prev.low_pct,'pp',-1):'—'}</td><td>${value(now,'reply_pct','%')}</td><td>${now&&prev?difference(now.reply_pct,prev.reply_pct,'pp',1):'—'}</td></tr>`).join('') || '<tr><td colspan="9">No data for selected gyms.</td></tr>';
  $('#trend-kpis').innerHTML=rows.map(({item,index,now,prev})=>`<div class="card trend-entity" style="--entity-color:${seriesColor(index,item.key)}" data-tip="${esc(`${item.label}: ${fmt(now?.count||0)} reviews in ${current||'this period'}`)}" tabindex="0"><h3>${seriesLogo(item)}<i></i>${esc(item.label)}</h3><div class="trend-entity-metrics"><div><small>Average ★</small><b>${value(now,'average_rating')}</b><span>${now&&prev?difference(now.average_rating,prev.average_rating,'★',1):'—'}</span></div><div><small>1–2 ★</small><b>${value(now,'low_pct','%')}</b><span>${now&&prev?difference(now.low_pct,prev.low_pct,'pp',-1):'—'}</span></div><div><small>Reviews</small><b>${value(now,'count')}</b><span>${now&&prev?difference(now.count,prev.count,'reviews',0):'—'}</span></div><div><small>Owner replies</small><b>${value(now,'reply_pct','%')}</b><span>${now&&prev?difference(now.reply_pct,prev.reply_pct,'pp',1):'—'}</span></div></div></div>`).join('');
  for (const [target,key,max,unit] of [['#compare-rating','average_rating',5,' ★'],['#compare-low','low_pct',100,'%'],['#compare-volume','count',0,''],['#compare-replies','reply_pct',100,'%']]) seriesLineChart(target,series,item=>item.rows,key,max,unit);
  renderCurrentChange(data);
}
async function loadPeriodComparison() {
  const request=++comparisonRequest, params=comparisonParams();
  $('#period-export').href='/export-series.csv?mode=periods&'+params;
  $('#current-change-export').href='/export-series.csv?mode=periods&kind=current_change&'+params;
  $('#period-summary').textContent='Loading period comparison…';
  try { const response=await fetch('/api/series?mode=periods&'+params); const result=await response.json(); if (!response.ok) throw new Error(result.error||'Could not load period comparison'); if (request===comparisonRequest) {comparisonData=result;selectedComparisonIndex=null;renderPeriodComparison(result);} }
  catch(error) {if(request===comparisonRequest) $('#period-summary').textContent=error.message;}
}

function sortedClubRows() {
  const rows = [...(overviewData?.clubs || [])];
  rows.sort((a,b) => {
    let delta;
    if (sortKey === 'name') delta = `${a.chain} ${a.club_name}`.localeCompare(`${b.chain} ${b.club_name}`);
    else {
      const value = x => sortKey === 'written_pct' ? x.written_count/x.count : sortKey === 'low_pct' ? x.low_rating_count/x.count : x[sortKey];
      delta = value(a) - value(b);
    }
    return (sortDescending ? -delta : delta) || b.count - a.count;
  });
  return rows;
}
function renderClubTable() {
  for (const button of document.querySelectorAll('[data-sort]')) {
    button.querySelector('.sort-arrow').textContent = button.dataset.sort === sortKey ? (sortDescending ? '▼' : '▲') : '';
    button.setAttribute('aria-sort', button.dataset.sort === sortKey ? (sortDescending ? 'descending' : 'ascending') : 'none');
  }
  const rows = sortedClubRows();
  $('#clubs-table').innerHTML = rows.length ? rows.map(x => `<tr><td>${brandLogo(x.chain)}${esc(x.chain)} · ${esc(x.club_name)}<div class="subtle">${esc(x.locality)}</div></td><td>${fmt(x.count)}</td><td>${x.average_rating.toFixed(2)}</td><td>${pct(x.written_count,x.count)}</td><td>${pct(x.low_rating_count,x.count)}</td></tr>`).join('') : '<tr><td colspan="5">No clubs match.</td></tr>';
}

function csvCell(value) { return `"${String(value ?? '').replaceAll('"','""')}"`; }
function exportSortedClubs(event) {
  event.preventDefault();
  const rows = sortedClubRows();
  const lines = [['Chain','Club','City','Reviews','Average rating','With comment','1–2 stars'], ...rows.map(x => [x.chain,x.club_name,x.locality,x.count,x.average_rating,pct(x.written_count,x.count),pct(x.low_rating_count,x.count)])];
  const blob = new Blob(['\ufeff' + lines.map(row => row.map(csvCell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'clubs_sorted.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function fetchData(form, offset = 0) {
  const params = query(form); params.set('offset', offset);
  const response = await fetch('/api/data?' + params);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load reviews');
  return result;
}
async function loadOverview() {
  if (!$('#overview-filters').reportValidity()) return;
  const request = ++overviewRequest;
  try { const response=await fetch('/api/series?mode=overview&'+query($('#overview-filters'))); const result=await response.json(); if(!response.ok) throw new Error(result.error||'Could not load overview'); if(request===overviewRequest){overviewData=result;renderOverview(result);} }
  catch (error) { if(request===overviewRequest) alert(error.message); }
}

function renderReviews(data) {
  const count = data.stats.review_count;
  $('#review-count').textContent = `· ${fmt(count)} matching`;
  $('#reviews').innerHTML = data.reviews.length ? data.reviews.map(row => {
    const club = byId.get(row.club_id);
    const heading = `${brandLogo(club.chain)}${esc(club.chain)} · ${esc(club.club_name)} <span class="stars">${'★'.repeat(row.rating)}</span>`;
    if (!row.text.trim()) return `<article class="review rating-only"><h3>${heading}</h3><div class="meta">${row.author ? esc(row.author) : 'Author unavailable'}</div></article>`;
    const directLink = row.review_url && (row.review_url.includes(row.review_id) || row.review_url.includes('/maps/reviews/data='));
    const linkLabel = directLink ? 'Review on Maps' : 'Club on Maps';
    const meta = `${esc(club.locality)} · ${row.date_precision === 'estimated' ? 'about ' : ''}${esc(row.published_at)}${row.published_label ? ` (${esc(row.published_label)})` : ''}${row.author ? ` · ${esc(row.author)}` : ''}${row.review_url ? ` · <a href="${esc(row.review_url)}" target="_blank" rel="noopener noreferrer">${linkLabel}</a>` : ''}`;
    const reply = row.owner_reply_text ? `<div class="reply"><b>Owner reply</b>${row.owner_reply_at ? ` · ${esc(row.owner_reply_at)}` : ''}<p class="reply-text">${esc(row.owner_reply_text)}</p></div>` : '';
    const shortened = /(?:…|\.\.\.)\s*(?:More|Daugiau)$/i.test(row.text) || /(?:…|\.\.\.)\s*(?:More|Daugiau)$/i.test(row.owner_reply_text || '');
    return `<article class="review" data-club-id="${esc(row.club_id)}" data-review-id="${esc(row.review_id)}"><h3>${heading}</h3><div class="meta">${meta}</div><p class="review-text">${esc(row.text)}</p>${reply}${shortened ? '<p class="shortened-note">Saved text appears shortened. Refresh this club to collect the full comment and reply.</p>' : ''}<div class="review-actions"><button type="button" class="translate-button" ${shortened ? 'disabled title="Refresh this club before translating"' : ''}>Translate</button><span class="translation-status" role="status"></span></div></article>`;
  }).join('') : '<p class="muted">No reviews match these filters.</p>';
  $('#page').textContent = `Page ${Math.floor(reviewOffset/50)+1} · ${fmt(count)} results`;
  $('#previous').disabled = reviewOffset === 0;
  $('#next').disabled = reviewOffset + 50 >= count;
  $('#reviews-export').href = '/export.csv?' + query($('#review-filters'));
  renderCoverage(data.coverage);
}
async function translateCard(button) {
  const card = button.closest('.review');
  const clubId = card.dataset.clubId, reviewId = card.dataset.reviewId;
  const row = reviewData?.reviews.find(item => item.club_id === clubId && item.review_id === reviewId);
  if (!row) return;
  const status = card.querySelector('.translation-status');
  if (button.dataset.translated === '1') {
    card.querySelector('.review-text').textContent = row.text;
    if (row.owner_reply_text) card.querySelector('.reply-text').textContent = row.owner_reply_text;
    button.dataset.translated = '';
    button.textContent = 'Show translation';
    status.textContent = '';
    return;
  }
  button.disabled = true;
  status.textContent = 'Translating…';
  try {
    const response = await fetch('/api/translate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({club_id:clubId, review_id:reviewId,
        target_language:$('#translation-language').value, model:$('#translation-model').value.trim()}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Translation failed');
    card.querySelector('.review-text').textContent = result.text;
    if (row.owner_reply_text) card.querySelector('.reply-text').textContent = result.reply;
    button.dataset.translated = '1';
    button.textContent = 'Show original';
    status.textContent = `${$('#translation-language').selectedOptions[0].text} translation${result.cached ? ' · saved locally' : ''}`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}
async function loadReviews() {
  if (!$('#review-filters').reportValidity()) return;
  try { reviewData = await fetchData($('#review-filters'), reviewOffset); renderReviews(reviewData); }
  catch (error) { alert(error.message); }
}

function aiModel() { return $('#ai-model').value === 'custom' ? $('#ai-custom-model').value.trim() : $('#ai-model').value; }
async function postAI(path, body) {
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Analysis failed');
  return result;
}
function renderAIEvidence(result, evidence) {
  const panel = $('#ai-evidence');
  const found = new Map(evidence.filter(row => /^R\d+$/.test(row.ref)).map(row => [row.ref, row]));
  const cited = [...new Set((result.textContent.match(/\[R\d+\]/gi) || []).map(ref => ref.slice(1, -1).toUpperCase()))].filter(ref => found.has(ref));
  const selected = cited.length ? cited : [...found.keys()].slice(0, 4);
  panel.hidden = !selected.length;
  if (!selected.length) return;
  panel.open = Boolean(cited.length);
  $('#ai-evidence-title').textContent = `Comments behind this answer (${selected.length})`;
  $('#ai-evidence-note').textContent = cited.length ? 'Select a reference in the answer to jump to its full comment.' : 'The model did not cite a comment. Here are examples from the analyzed comments; verify its claims against the review list.';
  $('#ai-evidence-list').innerHTML = selected.map(ref => {
    const row = found.get(ref);
    return `<article class="evidence-item" id="ai-evidence-${esc(ref)}"><h4>${esc(ref)} · ${esc(row.author || 'Anonymous')} · ${esc(row.club || '')}</h4><p class="hint">${esc(row.chain || '')} · ${esc(row.rating || '')} ★ · ${esc(row.date || '')}</p><p>${esc(row.comment || '')}</p>${row.owner_reply ? `<blockquote><strong>Owner reply</strong><p>${esc(row.owner_reply)}</p></blockquote>` : ''}${/^https:\/\//.test(row.review_url || '') ? `<a href="${esc(row.review_url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ''}</article>`;
  }).join('');
  const walker = document.createTreeWalker(result, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (/\[R\d+\]/i.test(walker.currentNode.textContent)) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const pieces = node.textContent.split(/(\[R\d+\])/gi);
    const fragment = document.createDocumentFragment();
    for (const piece of pieces) {
      const ref = /^\[(R\d+)\]$/i.exec(piece)?.[1]?.toUpperCase();
      if (ref && found.has(ref)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ai-cite'; button.textContent = `[${ref}]`;
        button.onclick = () => { panel.open = true; document.getElementById(`ai-evidence-${ref}`)?.scrollIntoView({behavior:'smooth', block:'center'}); };
        fragment.append(button);
      } else fragment.append(document.createTextNode(piece));
    }
    node.replaceWith(fragment);
  }
}
async function askAI() {
  if (!$('#review-filters').reportValidity()) return;
  const button = $('#ai-run'), status = $('#ai-status'), result = $('#ai-result');
  button.disabled = true; status.textContent = $('#ai-scope').value === 'all' ? 'Preparing full analysis…' : 'Analyzing a sample of matching written reviews…'; result.hidden = true; $('#ai-evidence').hidden = true;
  cancelAnalysis = false;
  $('#ai-cancel').disabled = false;
  $('#ai-cancel').hidden = $('#ai-scope').value !== 'all';
  try {
    const mode = selectedPreset()?.mode || 'question';
    const request = {mode, model:aiModel(), question:$('#ai-question').value.trim(), language:$('#ai-language').value};
    if (!request.model) throw new Error('Choose an analysis model.');
    let body;
    const evidence = [];
    if ($('#ai-scope').value === 'all') {
      const summaries = [];
      let offset = 0, eligible = null;
      status.textContent = 'Analyzing all matching comments in batches. This can take several minutes…';
      do {
        const batch = await postAI('/api/ai-batch?' + query($('#review-filters')),
          {...request, offset});
        if (!batch.processed) throw new Error('Full analysis stopped because a batch contained no reviews.');
        summaries.push(batch.answer);
        evidence.push(...(batch.evidence || []));
        offset += batch.processed;
        eligible = batch.eligible;
        status.textContent = `Read ${fmt(offset)} of ${fmt(eligible)} matching comments · ${summaries.length} AI batches. Synthesizing follows.`;
        if (cancelAnalysis) throw new Error(`Analysis stopped after ${fmt(offset)} of ${fmt(eligible)} comments. No complete result was produced.`);
      } while (offset < eligible);
      let layer = summaries;
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 6) {
          const combined = await postAI('/api/ai-combine', {...request, summaries:layer.slice(i, i + 6)});
          next.push(combined.answer);
          status.textContent = `Read all ${fmt(eligible)} matching comments · combining ${Math.min(i + 6, layer.length)} of ${layer.length} summaries.`;
          if (cancelAnalysis) throw new Error('Analysis stopped while combining summaries. No complete result was produced.');
        }
        layer = next;
      }
      body = {answer:layer[0], model:request.model, sampled:offset, eligible};
      status.textContent = `Full analysis: ${fmt(offset)} of ${fmt(eligible)} matching comments processed using ${body.model}.`;
    } else {
      body = await postAI('/api/ai?' + query($('#review-filters')), request);
      evidence.push(...(body.evidence || []));
      status.textContent = `Balanced sample: ${fmt(body.sampled)} of ${fmt(body.eligible)} eligible comments analyzed using ${body.model}. ${body.eligible > body.sampled ? 'Choose “All matching comments” to cover the rest.' : ''}`;
    }
    result.innerHTML = DOMPurify.sanitize(marked.parse(body.answer || '', {breaks:true}),
      {USE_PROFILES:{html:true}, FORBID_TAGS:['img','svg','math','iframe','video','audio'], FORBID_ATTR:['style']});
    for (const link of result.querySelectorAll('a')) {
      link.target = '_blank'; link.rel = 'noopener noreferrer';
    }
    renderAIEvidence(result, evidence);
    result.hidden = false;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; $('#ai-cancel').hidden = true; }
}

document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  const view = button.dataset.view;
  activeView = view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-active', x === button));
  $('#overview-view').hidden = view !== 'overview';
  $('#trends-view').hidden = view !== 'trends';
  $('#collection-view').hidden = view !== 'collection';
  $('#reviews-view').hidden = view !== 'reviews';
  if (view === 'collection') loadCollection();
  if (view === 'trends') loadPeriodComparison();
  if (view === 'reviews') { reviewOffset = 0; loadReviews(); }
  if (view === 'overview') loadOverview();
});
$('#collection-filter').onchange = () => { if (collectionData) renderCollection(collectionData); };
$('#comparison-grain').onchange = loadPeriodComparison;
function selectTrendPeriod(event) {
  const target = event.target.closest('[data-period-index]');
  if (!target || !comparisonData) return;
  selectedComparisonIndex = Number(target.dataset.periodIndex);
  renderPeriodComparison(comparisonData);
}
$('#trends-view').addEventListener('click', selectTrendPeriod);
$('#trends-view').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    if (event.target.closest('[data-period-index]')) { event.preventDefault(); selectTrendPeriod(event); }
  }
});
$('#retry-problem-clubs').onclick = () => requestCollection('attention');
$('#collection-rows').onclick = event => {
  const button = event.target.closest('[data-retry-club]');
  if (button) requestCollection('club', button.dataset.retryClub);
};
setInterval(() => { if (!$('#collection-view').hidden) loadCollection(); }, 5000);
document.addEventListener('click', event => {
  const rating = event.target.closest('[data-rating]');
  if (rating) { $('#overview-filters').elements.rating.value = rating.dataset.rating; syncFilters($('#overview-filters')); loadOverview(); }
});
document.querySelectorAll('[data-sort]').forEach(button => button.onclick = () => {
  const next = button.dataset.sort;
  sortDescending = next === sortKey ? !sortDescending : next !== 'name';
  sortKey = next; renderClubTable();
});
document.querySelector('[data-export="clubs"]').addEventListener('click', exportSortedClubs);
$('#previous').onclick = () => { reviewOffset = Math.max(0, reviewOffset - 50); loadReviews(); };
$('#next').onclick = () => { reviewOffset += 50; loadReviews(); };
$('#ai-run').onclick = askAI;
$('#ai-cancel').onclick = () => { cancelAnalysis = true; $('#ai-cancel').disabled = true; $('#ai-status').textContent = 'Stopping after the current batch…'; };
$('#ai-model').onchange = () => { $('#custom-model-label').hidden = $('#ai-model').value !== 'custom'; };
$('#ai-scope').onchange = () => {
  $('#ai-scope-note').textContent = $('#ai-scope').value === 'all' ?
    'Every matching complete written comment is analyzed in batches, then the summaries are combined. This can take many minutes and use substantial Hugging Face credits. Keep this page open until it finishes.' :
    'A balanced sample includes up to 60 complete written comments. The result shows how many matched and how many were analyzed. Choose “All matching comments” for full coverage.';
};
$('#reviews').onclick = event => {
  const button = event.target.closest('.translate-button');
  if (button) translateCard(button);
};
$('#translation-language').onchange = () => { if (reviewData) renderReviews(reviewData); };
$('#ai-mode').onchange = selectPrompt;
$('#prompt-save').onclick = () => savePrompt();
$('#prompt-copy').onclick = () => savePrompt(true);
$('#prompt-delete').onclick = deletePrompt;
for (const id of ['prompt-name','ai-question']) $("#" + id).addEventListener('input', () => {
  $('#prompt-status').textContent = 'Unsaved edits. Save this prompt to use it again later.';
});
renderPromptChoices();
loadPrompts();
loadOverview();
