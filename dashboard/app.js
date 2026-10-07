const clubs = JSON.parse(document.getElementById('club-directory').textContent);
const byId = new Map(clubs.map(c => [c.id, c]));
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '—';
const fmt = n => Number(n).toLocaleString();
let overviewData = null, reviewData = null, collectionData = null, reviewOffset = 0;
let activeClubId = '';
let sortKey = 'count', sortDescending = true;

function filterFields() {
  const choices = (items, label) => `<option value="">All ${label}</option>` + items.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  const chains = [...new Set(clubs.map(c => c.chain))].sort();
  const cities = [...new Set(clubs.map(c => c.locality))].sort();
  return `
    <label>Period<select name="period"><option value="all">All time</option><option value="last_30_days">Last 30 days</option><option value="previous_month">Previous month</option><option value="custom">Custom dates</option></select></label>
    <label>From<input type="date" name="start" disabled></label><label>To<input type="date" name="end" disabled></label>
    <label>Chain<select name="chain">${choices(chains, 'chains')}</select></label>
    <label>City<select name="city">${choices(cities, 'cities')}</select></label>
    <label>Club<select name="club_id"><option value="">All clubs</option>${clubs.map(c => `<option value="${esc(c.id)}">${esc(c.chain)} · ${esc(c.club_name)} · ${esc(c.locality)}</option>`).join('')}</select></label>
    <label>Stars<select name="rating"><option value="">All ratings</option>${[1,2,3,4,5].map(n => `<option value="${n}">${n}</option>`).join('')}</select></label>
    <label>Written comment<select name="comment"><option value="all">All reviews</option><option value="written">With comment</option><option value="rating_only">Rating only</option></select></label>
    <label>Owner reply<select name="reply"><option value="all">All reviews</option><option value="replied">With reply</option><option value="unreplied">Without reply</option></select></label>
    <label>Search text<input name="q" type="search" placeholder="e.g. cleanliness"></label>
    <button type="submit">Apply filters</button>`;
}

for (const id of ['overview-filters', 'review-filters']) {
  const form = document.getElementById(id);
  form.innerHTML = filterFields();
  form.elements.period.onchange = () => {
    const active = form.elements.period.value === 'custom';
    form.elements.start.disabled = !active;
    form.elements.end.disabled = !active;
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (id === 'overview-filters') loadOverview();
    else { reviewOffset = 0; loadReviews(); }
  };
}

function query(form) {
  const params = new URLSearchParams(new FormData(form));
  if (params.get('period') !== 'custom') { params.delete('start'); params.delete('end'); }
  for (const [key, value] of [...params]) if (!value) params.delete(key);
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
    let points = [], segments = [];
    for (let i = 0; i <= rows.length; i++) {
      if (rows[i]?.average_rating != null) points.push(`${x(i)},${y(rows[i].average_rating)}`);
      else if (points.length) { segments.push(`<polyline class="trend-line" points="${points.join(' ')}"/>`); points = []; }
    }
    marks = segments.join('') + rows.map((row, i) => row.average_rating == null ? '' : `<circle class="plot-dot" tabindex="0" cx="${x(i)}" cy="${y(row.average_rating)}" r="5" data-tip="${esc(`${row.period}: ${row.average_rating} ★ from ${fmt(row.count)} reviews`)}"/>`).join('');
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
  $('#reviews-updated').textContent = label;
  $('#collection-updated').textContent = label;
  const quality = coverage.date_quality || {};
  const estimated = quality.estimated || 0, unknown = quality.unknown || 0;
  $('#overview-quality').textContent = `Across the archive, ${fmt(estimated)} reviews have estimated dates${unknown ? ` and ${fmt(unknown)} have unknown date precision` : ''}; ${fmt(coverage.shortened_reviews || 0)} have shortened comment or reply text. Time charts and date filters use the stored dates. “Known missing” counts only clubs where Maps supplied a total; unknown coverage is never counted as zero.`;
  const entries = clubs.filter(c => c.status === 'open').map(c => ({ club: c, info: coverage.clubs[c.id] || {} }));
  entries.sort((a, b) => Number(a.info.complete) - Number(b.info.complete) || a.club.chain.localeCompare(b.club.chain));
  $('#coverage-list').innerHTML = entries.map(({club, info}) => {
    const count = info.collected || 0;
    const expected = info.displayed_review_count;
    const state = info.state === 'unchecked' ? 'not checked' : info.state === 'error' ? 'error' : info.state === 'shortened' ? `${fmt(info.shortened_count)} shortened` : expected == null ? 'coverage unknown' : info.complete ? 'complete' : `${Math.max(expected-count,0)} missing`;
    const checked = info.scraped_at ? ` · checked ${esc(new Date(info.scraped_at).toLocaleDateString())}` : '';
    return `<div class="coverage-row"><span>${esc(club.chain)} · ${esc(club.club_name)} · ${esc(club.locality)}${checked}${info.last_error ? ` · ${esc(info.last_error)}` : ''}</span><b>${fmt(count)}/${expected == null ? '?' : fmt(expected)} · ${state}</b></div>`;
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
  $('#collection-progress-label').textContent = `${fmt(states.complete || 0)} of ${fmt(coverage.open)} open clubs have verified counts and full saved text · ${fmt(coverage.missing_known)} known reviews missing · ${fmt(coverage.shortened_reviews || 0)} shortened`;
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
    return `<tr><td><b>${esc(club.chain)} · ${esc(club.club_name)}</b><div class="subtle">${esc(club.locality)}</div></td><td><span class="status-pill ${club.id === activeClubId ? 'scanning' : esc(info.state)}">${club.id === activeClubId ? 'Scanning' : collectionStateLabel(info.state)}</span></td><td>${fmt(info.collected || 0)} / ${expected == null ? 'Unknown' : fmt(expected)}</td><td>${esc(checked)}</td><td class="collection-detail">${esc(detail)}</td><td><button type="button" class="retry-club" data-retry-club="${esc(club.id)}">${info.state === 'complete' ? 'Refresh' : 'Retry'}</button></td></tr>`;
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

function renderOverview(data) {
  const s = data.stats, count = s.review_count;
  $('#count').textContent = fmt(count); $('#average').textContent = s.average_rating ?? '—';
  $('#written').textContent = fmt(s.written_count); $('#written-pct').textContent = `${pct(s.written_count,count)} of reviews`;
  $('#low').textContent = fmt(s.low_rating_count); $('#low-pct').textContent = `${pct(s.low_rating_count,count)} of reviews`;
  $('#replied').textContent = fmt(s.replied_count); $('#reply-pct').textContent = `${pct(s.replied_count,count)} of reviews`;
  $('#low-reply').textContent = pct(s.low_rating_replied_count,s.low_rating_count);
  renderCoverage(data.coverage);
  $('#distribution').innerHTML = [5,4,3,2,1].map(n => `<button type="button" class="distribution-row" data-rating="${n}" data-tip="${n} stars: ${fmt(s.ratings[n])} reviews (${pct(s.ratings[n],count)})"><span>${n} ★</span><span class="bar-track"><span class="bar-fill" style="width:${count ? 100*s.ratings[n]/count : 0}%"></span></span><span>${fmt(s.ratings[n])}</span></button>`).join('');
  $('#trend-note').textContent = `${{day:'Daily',month:'Monthly',year:'Yearly'}[data.charts.grain]} totals · some review dates may be estimated`;
  renderPlot('#trend', data.charts.trend, 'count');
  renderPlot('#rating-trend', data.charts.trend, 'average_rating');
  $('#chains').innerHTML = data.charts.chains.length ? data.charts.chains.map(row => `<button type="button" class="compare-row" data-chain="${esc(row.chain)}" data-tip="${esc(`${row.chain}: ${row.average_rating} ★ from ${fmt(row.count)} reviews`)}"><b>${esc(row.chain)}</b><span class="bar-track"><span class="bar-fill" style="width:${100*row.average_rating/5}%"></span></span><span>${row.average_rating.toFixed(2)} ★</span><span>${fmt(row.count)}</span></button>`).join('') : '<p class="muted">No reviews in this selection.</p>';
  renderClubTable();
  const suffix = query($('#overview-filters')).toString();
  for (const link of document.querySelectorAll('[data-export]')) link.href = `/export-chart.csv?kind=${link.dataset.export}&${suffix}`;
}

function sortedClubRows() {
  const rows = [...(overviewData?.charts.clubs || [])];
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
  $('#clubs-table').innerHTML = rows.length ? rows.map(x => `<tr><td>${esc(x.chain)} · ${esc(x.club_name)}<div class="subtle">${esc(x.locality)}</div></td><td>${fmt(x.count)}</td><td>${x.average_rating.toFixed(2)}</td><td>${pct(x.written_count,x.count)}</td><td>${pct(x.low_rating_count,x.count)}</td></tr>`).join('') : '<tr><td colspan="5">No clubs match.</td></tr>';
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
  try { overviewData = await fetchData($('#overview-filters')); renderOverview(overviewData); }
  catch (error) { alert(error.message); }
}

function renderReviews(data) {
  const count = data.stats.review_count;
  $('#review-count').textContent = `· ${fmt(count)} matching`;
  $('#reviews').innerHTML = data.reviews.length ? data.reviews.map(row => {
    const club = byId.get(row.club_id);
    const heading = `${esc(club.chain)} · ${esc(club.club_name)} <span class="stars">${'★'.repeat(row.rating)}</span>`;
    if (!row.text.trim()) return `<article class="review rating-only"><h3>${heading}</h3></article>`;
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
        target_language:$('#translation-language').value, model:$('#ai-model').value.trim()}),
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
  try { reviewData = await fetchData($('#review-filters'), reviewOffset); renderReviews(reviewData); }
  catch (error) { alert(error.message); }
}

async function askAI() {
  const button = $('#ai-run'), status = $('#ai-status'), result = $('#ai-result');
  button.disabled = true; status.textContent = 'Analyzing a sample of matching written reviews…'; result.hidden = true;
  try {
    const mode = $('#ai-mode').value;
    const response = await fetch('/api/ai?' + query($('#review-filters')), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({mode, model:$('#ai-model').value.trim(), question:$('#ai-question').value.trim()}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Analysis failed');
    status.textContent = `Analyzed ${fmt(body.sampled)} of ${fmt(body.eligible)} eligible comments using ${body.model}.`;
    result.textContent = body.answer; result.hidden = false;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}

document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  const view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('nav-active', x === button));
  $('#overview-view').hidden = view !== 'overview';
  $('#collection-view').hidden = view !== 'collection';
  $('#reviews-view').hidden = view !== 'reviews';
  if (view === 'collection') loadCollection();
  if (view === 'reviews' && !reviewData) loadReviews();
});
$('#collection-filter').onchange = () => { if (collectionData) renderCollection(collectionData); };
$('#retry-problem-clubs').onclick = () => requestCollection('attention');
$('#collection-rows').onclick = event => {
  const button = event.target.closest('[data-retry-club]');
  if (button) requestCollection('club', button.dataset.retryClub);
};
setInterval(() => { if (!$('#collection-view').hidden) loadCollection(); }, 5000);
document.addEventListener('click', event => {
  const rating = event.target.closest('[data-rating]');
  if (rating) { $('#overview-filters').elements.rating.value = rating.dataset.rating; loadOverview(); }
  const chain = event.target.closest('[data-chain]');
  if (chain) { $('#overview-filters').elements.chain.value = chain.dataset.chain; loadOverview(); }
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
$('#reviews').onclick = event => {
  const button = event.target.closest('.translate-button');
  if (button) translateCard(button);
};
$('#translation-language').onchange = () => { if (reviewData) renderReviews(reviewData); };
$('#ai-mode').onchange = () => {
  if ($('#ai-mode').value === 'issues') $('#ai-question').value = 'Summarize the main recurring issues. Include concrete examples with review IDs.';
  else if ($('#ai-mode').value === 'summary') $('#ai-question').value = 'Summarize the main positive and negative themes. Include concrete examples with review IDs.';
  else $('#ai-question').value = '';
};
loadOverview();
