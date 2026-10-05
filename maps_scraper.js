// Local, browser-based Google Maps review collector. Run with Node.js and Playwright.
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const DATA = process.env.GYM_DATA_DIR || path.join(ROOT, 'data');
const PROFILE = path.join(DATA, 'maps-browser-profile');
const MATCHES_FILE = path.join(DATA, 'maps-place-urls.json');
const MATCHES_SEED = process.env.GYM_PLACES_FILE || path.join(ROOT, 'verified_maps_places.json');
const REPORT_FILE = path.join(DATA, 'scrape-report.json');
const DIRECTORY = process.env.GYM_DIRECTORY_FILE || path.join(ROOT, 'gyms_lt.json');
const CLUBS = JSON.parse(fs.readFileSync(DIRECTORY, 'utf8')).clubs;
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME = process.env.GYM_BROWSER_EXECUTABLE ||
  (fs.existsSync(MAC_CHROME) ? MAC_CHROME : chromium.executablePath());
const BACKEND = process.env.GYM_REVIEW_APP_EXE;
const STOP_FILE = process.env.GYM_STOP_FILE;
const stopRequested = () => Boolean(STOP_FILE && fs.existsSync(STOP_FILE));

function reviewApp(args) {
  return BACKEND
    ? spawnSync(BACKEND, args, { encoding: 'utf8', env: process.env })
    : spawnSync('python3', [path.join(ROOT, 'review_app.py'), ...args], { encoding: 'utf8', env: process.env });
}

function args() {
  const raw = process.argv.slice(2);
  const command = raw.shift() || 'help';
  const option = (name, fallback = null) => {
    const i = raw.indexOf(name);
    return i < 0 ? fallback : raw[i + 1];
  };
  return {
    command, club: option('--club'), clubs: option('--clubs'), all: raw.includes('--all'),
    headless: raw.includes('--headless'),
    retry: raw.includes('--retry'),
    incremental: raw.includes('--incremental'),
    max: Number(option('--max-reviews', '0')),
    sort: option('--sort'),
    lite: raw.includes('--lite'),
    restartEvery: Number(option('--restart-every', '0')),
  };
}

function loadMatches() {
  if (!fs.existsSync(MATCHES_FILE) && fs.existsSync(MATCHES_SEED)) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.copyFileSync(MATCHES_SEED, MATCHES_FILE);
  }
  if (!fs.existsSync(MATCHES_FILE)) return {};
  return JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
}
function saveMatches(matches) {
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2) + '\n');
}
function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"';
}
function csv(rows) {
  const fields = ['club_id', 'review_id', 'rating', 'published_at', 'text', 'author',
    'review_url', 'owner_reply_text', 'owner_reply_at', 'published_label', 'date_precision'];
  return [fields.join(','), ...rows.map(row => fields.map(key => csvCell(row[key])).join(','))].join('\n') + '\n';
}
function searchUrl(club) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(club.google_maps_search_query);
}
function normalized(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function streetMatches(summary, street) {
  const tokens = normalized(street).match(/[a-z0-9]+/g) || [];
  const key = tokens.filter(t => t.length >= 3).sort((a, b) => b.length - a.length)[0];
  const number = tokens.find(t => /\d/.test(t));
  const candidate = normalized(summary);
  return !!key && !!number && candidate.includes(key) && candidate.includes(number);
}
function chainMatches(name, chain) {
  const value = normalized(name).replace(/[^a-z0-9+]+/g, ' ');
  if (chain === 'Gym+') return /gym\s*\+|gym\s*plius/.test(value);
  if (chain === 'Lemon Gym') return value.includes('lemon gym');
  return value.includes('sportgates') || value.includes('sport gates');
}
async function dismissConsent(page) {
  if (!page.url().includes('consent.google.com')) return;
  const button = page.getByRole('button', { name: /Reject all|Atmesti viską/i });
  if (await button.count()) await button.first().click();
}
async function launch(headless, lite = false) {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(CHROME)) throw new Error('Bundled browser was not found at ' + CHROME);
  // Chrome otherwise restores tabs saved by a previous interrupted run.
  // This does not remove cookies or the Maps sign-in from the profile.
  const sessions = path.join(PROFILE, 'Default', 'Sessions');
  if (fs.existsSync(sessions)) {
    for (const name of fs.readdirSync(sessions)) {
      if (/^(Session|Tabs)_/.test(name)) fs.rmSync(path.join(sessions, name));
    }
  }
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless, locale: 'en-US', viewport: { width: 1400, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
      ...(lite ? ['--disable-gpu', '--disable-dev-shm-usage'] : [])],
  });
  if (lite) await context.route('**/*', route =>
    ['image', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue());
  return context;
}
async function freshPage(context) {
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  for (const old of pages.slice(1)) await old.close().catch(() => {});
  return page;
}

async function resolvePlace(page, club, matches, rl) {
  if (matches[club.id]) return matches[club.id];
  if (club.google_place_id) {
    const url = searchUrl(club) + '&query_place_id=' + encodeURIComponent(club.google_place_id);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissConsent(page);
    await page.waitForTimeout(1500);
    const address = await page.locator('[data-item-id="address"]').first().innerText().catch(() => '');
    if (!streetMatches(address, club.street_address)) {
      throw new Error('Chain-published place ID did not resolve to the expected street address');
    }
    matches[club.id] = url;
    saveMatches(matches);
    console.log('Using chain-published Google place ID:', club.id, club.google_place_id);
    return url;
  }
  await page.goto(searchUrl(club), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissConsent(page);
  await page.waitForFunction(
    () => location.pathname.includes('/maps/place/') || !!document.querySelector('[role="article"]'),
    null, { timeout: 20000 }
  );
  if (page.url().includes('/maps/place/')) {
    const panel = await page.locator('body').innerText();
    if (!streetMatches(panel, club.street_address)) {
      throw new Error('Direct place result did not contain the expected street address');
    }
    matches[club.id] = page.url();
    saveMatches(matches);
    console.log('Matched direct place result:', club.street_address, page.url());
    return page.url();
  }
  await page.locator('[role="article"]').first().waitFor({ timeout: 20000 });
  const candidates = await page.locator('[role="article"]').evaluateAll(articles => articles.map(a => ({
    name: a.querySelector('a.hfpxzc')?.getAttribute('aria-label') || '',
    url: a.querySelector('a.hfpxzc')?.href || '',
    summary: a.innerText.replace(/\s+/g, ' ').slice(0, 220),
  })).filter(x => x.url));
  if (!candidates.length) throw new Error('No Maps place found for ' + club.id);
  let selected;
  if (candidates.length === 1 && candidates[0].summary.toLowerCase().includes(club.street_address.toLowerCase())) {
    selected = candidates[0];
    console.log('Matched one result:', selected.summary);
  } else {
    const ranked = candidates.map(c => ({ ...c,
      score: (streetMatches(c.summary, club.street_address) ? 10 : 0) +
        (chainMatches(c.name, club.chain) ? 5 : 0) -
        (/sponsored/i.test(c.summary) ? 10 : 0),
    })).sort((a, b) => b.score - a.score);
    if (ranked[0]?.score >= 15 && ranked[0].score >= (ranked[1]?.score ?? -100) + 3) {
      selected = ranked[0];
      console.log('Matched unique address and chain:', selected.summary);
    } else {
    fs.writeFileSync(path.join(DATA, `ambiguous_${club.id}.json`), JSON.stringify(candidates, null, 2) + '\n');
    console.log(`\nChoose the Maps listing for ${club.chain} ${club.club_name}, ${club.street_address}, ${club.locality}:`);
    candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.summary}\n     ${c.url}`));
    if (!process.stdin.isTTY) throw new Error('Multiple candidates; rerun in an interactive terminal to choose one');
    const answer = (await rl.question('Listing number, or Enter to skip: ')).trim();
    if (!answer) return null;
    selected = candidates[Number(answer) - 1];
    if (!selected) throw new Error('Invalid listing number');
    }
  }
  matches[club.id] = selected.url;
  saveMatches(matches);
  return selected.url;
}

async function clickReviews(page) {
  const selectors = [
    'button[jsaction*="moreReviews"]',
    '[role="tab"]:has-text("Reviews")',
    '[role="tab"]:has-text("Atsiliepimai")',
    'button:has-text("reviews")',
    'button:has-text("atsiliepimai")',
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 10000 });
      return;
    }
  }
  throw new Error('Reviews control unavailable. Sign in to Maps in this scraper browser, or inspect the saved debug screenshot.');
}

async function expandVisibleReviews(page) {
  // Google Maps also has a generic "More" control on reviewer profiles. Clicking
  // that repeatedly opens contributor tabs, so only use the review expansion action.
  await page.locator(reviewSelector()).evaluateAll(cards => {
    for (const card of cards) {
      for (const button of card.querySelectorAll('button[jsaction*="Original"], button[jsaction*="expandReview"]')) {
        if (button.dataset.scraperExpanded) continue;
        button.dataset.scraperExpanded = '1';
        button.click();
      }
    }
  });
}
function reviewSelector() { return '.jftiEf[data-review-id]'; }

// The visible Maps review date is usually relative (e.g. "2 months ago").
// This estimates a date and marks its precision; it must not be treated as exact.
function dateFromLabel(label, today = new Date()) {
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const exact = label.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (exact) return { date: exact[0], precision: 'exact' };
  if (/today|šiandien|just now|ką tik/i.test(label)) {
    return { date: localDate(today), precision: 'estimated' };
  }
  const n = Number(label.match(/\d+/)?.[0] || 1);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (/yesterday|vakar/i.test(label)) d.setDate(d.getDate() - 1);
  else if (/hour|minut|second|valand|sekund/i.test(label)) return { date: localDate(d), precision: 'estimated' };
  else if (/day|dien/i.test(label)) d.setDate(d.getDate() - n);
  else if (/week|savait/i.test(label)) d.setDate(d.getDate() - 7 * n);
  else if (/month|mėnes/i.test(label)) d.setMonth(d.getMonth() - n);
  else if (/year|met/i.test(label)) d.setFullYear(d.getFullYear() - n);
  else return { date: '', precision: 'unknown' };
  return { date: localDate(d), precision: 'estimated' };
}

async function extractCards(page, club, placeUrl) {
  const raw = await page.locator(reviewSelector()).evaluateAll(cards => cards.map(card => {
    const one = selector => card.querySelector(selector);
    const text = selector => one(selector)?.innerText?.trim() || '';
    const ratingLabel = one('.kvMYJc, [role="img"][aria-label*="star"], [role="img"][aria-label*="žvaig"]')?.getAttribute('aria-label') || '';
    return {
      review_id: card.getAttribute('data-review-id') || one('[data-review-id]')?.getAttribute('data-review-id') || '',
      author: text('.d4r55, .WNxzHc'),
      rating_label: ratingLabel,
      published_label: text('.rsqaWe, .xRkPPb'),
      text: text('.wiI7pd, .MyEned'),
      owner_reply_text: text('.CDe7pd .wiI7pd, .CDe7pd .MyEned'),
      owner_reply_at: text('.CDe7pd .rsqaWe'),
    };
  }));
  return raw.map(item => {
    const rating = Number(item.rating_label.match(/[1-5](?:[.,]\d)?/)?.[0]?.replace(',', '.') || 0);
    const date = dateFromLabel(item.published_label);
    return {
      club_id: club.id, review_id: item.review_id, rating: Math.round(rating),
      published_at: date.date, published_label: item.published_label,
      date_precision: date.precision, text: item.text, author: item.author,
      review_url: placeUrl, owner_reply_text: item.owner_reply_text,
      owner_reply_at: dateFromLabel(item.owner_reply_at).date,
    };
  }).filter(item => item.review_id && item.rating >= 1 && item.rating <= 5 && item.published_at);
}

async function scrollReviewList(page) {
  return page.locator(reviewSelector()).last().evaluate(card => {
    let node = card.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 100 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)) {
        node.scrollTop = node.scrollHeight;
        return { top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight };
      }
      node = node.parentElement;
    }
    return null;
  });
}

function recordFreshCards(rows, collected, seen, knownIds, knownStreak = 0) {
  for (const row of rows) {
    if (seen.has(row.review_id)) continue;
    seen.add(row.review_id);
    collected.set(row.review_id, row);
    knownStreak = knownIds.has(row.review_id) ? knownStreak + 1 : 0;
  }
  return knownStreak;
}

async function scrapePlace(page, club, placeUrl, maxReviews, sortPreference, knownIds = null) {
  await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissConsent(page);
  const reviewControls = '[role="tab"]:has-text("Reviews"), [role="tab"]:has-text("Atsiliepimai"), button[jsaction*="moreReviews"]';
  await page.locator(reviewControls).first().waitFor({ timeout: 20000 }).catch(() => {});
  const countLabel = await page.locator('button[jsaction*="reviewChart.moreReviews"]').first().innerText().catch(() => '');
  const expected = Number(countLabel.replace(/[^\d]/g, '')) || null;
  const reviewTabs = await page.locator(reviewControls).count();
  if (!reviewTabs && /\bNo reviews\b|Atsiliepimų nėra/i.test(await page.locator('body').innerText())) {
    return { rows: [], expected: 0 };
  }
  if (!reviewTabs) throw new Error('Maps review controls did not load; review count is unverified');
  await clickReviews(page);
  await page.locator(reviewSelector()).first().waitFor({ timeout: 20000 });
  const collected = new Map();
  const seen = new Set();
  let knownStreak = 0;
  let crashed = false;
  let stopped = false;
  const sortButton = page.locator('button[aria-label="Sort reviews"], button[aria-label*="Rūšiuoti"]').first();
  const sortNames = { relevant: 'Most relevant', newest: 'Newest', highest: 'Highest rating', lowest: 'Lowest rating' };
  const sorts = knownIds ? ['Newest'] : sortPreference ? [sortNames[sortPreference]] :
    maxReviews > 0 ? ['Newest'] : ['Most relevant', 'Newest', 'Highest rating', 'Lowest rating'];
  for (const sort of sorts) {
    try {
    let previousUnique = collected.size;
    let duplicateSteps = 0;
    if (await sortButton.isVisible().catch(() => false)) {
      await sortButton.click();
      const option = page.getByRole('menuitemradio', { name: sort, exact: true }).first();
      if (await option.isVisible().catch(() => false)) {
        await option.click({ timeout: 5000 });
        await page.locator(reviewSelector()).first().waitFor({ timeout: 60000 });
      } else {
        await page.keyboard.press('Escape');
        if (knownIds) throw new Error('Newest sort is unavailable; incremental refresh cannot verify new reviews');
      }
    } else if (knownIds) {
      throw new Error('Review sort control is unavailable; incremental refresh cannot verify new reviews');
    }
    let stagnant = 0;
    for (let step = 0; step < 1000; step++) {
      if (stopRequested()) { stopped = true; break; }
      await expandVisibleReviews(page);
      const visible = await extractCards(page, club, placeUrl);
      if (knownIds) {
        const fresh = visible.filter(row => !seen.has(row.review_id));
        if (fresh.length) knownStreak = recordFreshCards(fresh, collected, seen, knownIds, knownStreak);
      } else for (const row of visible) collected.set(row.review_id, row);
      duplicateSteps = collected.size === previousUnique ? duplicateSteps + 1 : 0;
      previousUnique = collected.size;
      if (step % 10 === 0 || duplicateSteps === 15) console.log(`${club.id} [${sort}]: ${collected.size} unique reviews`);
      if ((knownIds && knownStreak >= 30) || (!knownIds && expected && collected.size >= expected) || (maxReviews > 0 && collected.size >= maxReviews)) break;
      if (sort !== 'Most relevant' && duplicateSteps >= 15) break;
      const beforeCards = await page.locator(reviewSelector()).count();
      const scroll = await scrollReviewList(page);
      if (!scroll) break;
      await page.waitForFunction(previous => document.querySelectorAll('.jftiEf[data-review-id]').length > previous,
        beforeCards, { timeout: 6000 }).catch(() => {});
      const afterScroll = await extractCards(page, club, placeUrl);
      if (knownIds) {
        const fresh = afterScroll.filter(row => !seen.has(row.review_id));
        if (fresh.length) knownStreak = recordFreshCards(fresh, collected, seen, knownIds, knownStreak);
      } else for (const row of afterScroll) collected.set(row.review_id, row);
      const afterCards = await page.locator(reviewSelector()).count();
      stagnant = afterCards === beforeCards ? stagnant + 1 : 0;
      if (stagnant > 0) console.log(`${club.id} [${sort}]: no new cards (${stagnant}), ${afterCards} cards, scroll ${scroll.top}/${scroll.height}`);
      if (stagnant >= 5) break;
    }
    if (stopped || (knownIds && knownStreak >= 30) || (!knownIds && expected && collected.size >= expected) || (maxReviews > 0 && collected.size >= maxReviews)) break;
    } catch (error) {
      console.warn(`${club.id} [${sort}]: ${error.message}; retaining ${collected.size} reviews collected so far`);
      if (/crash|has been closed|Target closed|Browser closed/i.test(error.message)) {
        crashed = true;
        break;
      }
    }
  }
  return { rows: [...collected.values()], expected, crashed, stopped };
}

async function main() {
  const a = args();
  if (a.sort && !['relevant', 'newest', 'highest', 'lowest'].includes(a.sort)) {
    throw new Error('--sort must be relevant, newest, highest, or lowest');
  }
  if (!Number.isInteger(a.restartEvery) || a.restartEvery < 0) {
    throw new Error('--restart-every must be a nonnegative integer');
  }
  if (a.command === 'status') {
    const report = fs.existsSync(REPORT_FILE) ? JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')) : {};
    const open = CLUBS.filter(c => c.status === 'open');
    console.log(`${Object.values(report).filter(r => r.complete).length}/${open.length} open clubs complete; ${Object.keys(report).length} attempted.`);
    for (const club of open) {
      const item = report[club.id];
      if (item) console.log(`${item.complete ? 'complete' : 'partial '} ${club.id}: ${item.collected}/${item.displayed_review_count ?? '?'}`);
    }
    return;
  }
  if (!['login', 'run'].includes(a.command)) {
    console.log('Usage: node maps_scraper.js login | status | run --club CLUB_ID | run --clubs ID1,ID2 [--sort newest] [--restart-every 0] | run --all [--retry] [--incremental]');
    process.exit(a.command === 'help' ? 0 : 1);
  }
  const requestedIds = new Set(a.clubs?.split(',').filter(Boolean) || (a.club ? [a.club] : []));
  const selected = a.all ? CLUBS.filter(c => c.status === 'open') : CLUBS.filter(c => requestedIds.has(c.id));
  if (a.command === 'run' && (!selected.length || (!a.all && selected.length !== requestedIds.size))) {
    throw new Error('Choose valid --club CLUB_ID or --clubs ID1,ID2 from gyms_lt.json, or --all');
  }
  let context = await launch(a.headless, a.lite);
  let page = await freshPage(context);
  const guardTabs = browserContext => {
    if (a.command !== 'run') return;
    browserContext.on('page', opened => {
      if (opened !== page) {
        console.warn('Closing an unexpected Maps tab');
        opened.close().catch(() => {});
      }
    });
  };
  guardTabs(context);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (a.command === 'login') {
      await page.goto('https://www.google.com/maps/', { waitUntil: 'domcontentloaded' });
      await dismissConsent(page);
      console.log('Sign in to Google Maps in the opened browser. Then press Enter here.');
      await rl.question('Press Enter when ready: ');
      return;
    }
    const matches = loadMatches();
    const report = fs.existsSync(REPORT_FILE) ? JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')) : {};
    let total = 0;
    let clubsInBrowser = 0;
    const restartBrowser = async () => {
      await context.close().catch(() => {});
      context = await launch(a.headless, a.lite);
      page = await freshPage(context);
      guardTabs(context);
      clubsInBrowser = 0;
      console.log('Restarted Chrome for the next clubs');
    };
    for (const club of selected) {
      if (stopRequested()) { console.log('Stop requested; ending after the previous club.'); break; }
      const previous = report[club.id];
      if (a.all && previous?.complete && !a.retry) {
        console.log(`${club.id}: already checked (${previous.collected}/${previous.displayed_review_count}); use --retry to run again`);
        continue;
      }
      try {
        const placeUrl = await resolvePlace(page, club, matches, rl);
        if (!placeUrl) continue;
        let knownIds = null;
        if (a.incremental && previous?.complete) {
          const result = reviewApp(['review-ids', club.id]);
          if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
          knownIds = new Set(JSON.parse(result.stdout));
          if (!knownIds.size) knownIds = null;
        }
        const { rows, expected, crashed, stopped } = await scrapePlace(page, club, placeUrl, a.max, a.sort, knownIds);
        if (!rows.length && expected !== 0 && !stopped) throw new Error('No review cards were parsed');
        let stored;
        if (rows.length) {
          const file = path.join(DATA, `reviews_${club.id}.csv`);
          fs.writeFileSync(file, csv(rows));
          const synced = reviewApp(['sync-club', club.id, file]);
          if (synced.status !== 0) throw new Error(synced.error?.message || synced.stderr || synced.stdout);
          console.log(synced.stdout.trim().split('\n')[0]);
          stored = Number(synced.stdout.match(/SYNC_RESULT=(\d+)/)?.[1]);
          if (!Number.isFinite(stored)) throw new Error('Could not read the saved review count');
        } else {
          const countResult = reviewApp(['count-club', club.id]);
          if (countResult.status !== 0) throw new Error(countResult.error?.message || countResult.stderr || countResult.stdout);
          stored = Number(countResult.stdout.trim());
        }
        report[club.id] = {
          collected: stored, collected_this_run: rows.length, displayed_review_count: expected,
          complete: expected !== null && stored >= expected,
          scraped_at: new Date().toISOString(), place_url: placeUrl,
        };
        fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n');
        if (!report[club.id].complete) {
          await page.screenshot({ path: path.join(DATA, `incomplete_${club.id}.png`), fullPage: false }).catch(() => {});
        }
        console.log(`${club.id}: coverage ${stored}/${expected ?? '?'}${report[club.id].complete ? ' complete' : ' unverified'}`);
        total += rows.length;
        if (crashed) {
          console.warn('Chrome closed or crashed. Stopping this batch to avoid opening another window.');
          break;
        }
        if (stopped) { console.log('Stop requested; saved the reviews collected so far.'); break; }
      } catch (error) {
        const debug = path.join(DATA, `debug_${club.id}.png`);
        await page.screenshot({ path: debug, fullPage: false }).catch(() => {});
        console.error(`${club.id}: ${error.message}\nDebug screenshot: ${debug}`);
        if (/crash|has been closed|Target closed|Browser closed/i.test(error.message)) {
          console.warn('Chrome closed or crashed. Stopping this batch to avoid opening another window.');
          break;
        }
      }
      clubsInBrowser++;
      if (a.restartEvery > 0 && clubsInBrowser >= a.restartEvery) await restartBrowser();
    }
    console.log(`Done. ${total} review rows collected this run. Open http://127.0.0.1:8765/ to view them.`);
  } finally {
    rl.close();
    await context.close().catch(() => {});
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { dateFromLabel, csv, recordFreshCards };
