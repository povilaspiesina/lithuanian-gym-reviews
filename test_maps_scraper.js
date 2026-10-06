const assert = require('node:assert/strict');
const test = require('node:test');
const { dateFromLabel, csv, recordFreshCards, gotoMaps, shouldSkipClub } = require('./maps_scraper');

test('relative review dates are marked estimated', () => {
  assert.deepEqual(dateFromLabel('2 weeks ago', new Date('2026-10-01T12:00:00Z')),
    { date: '2026-09-17', precision: 'estimated' });
  assert.deepEqual(dateFromLabel('2026-09-15'),
    { date: '2026-09-15', precision: 'exact' });
  assert.deepEqual(dateFromLabel('3 hours ago', new Date('2026-10-01T12:00:00Z')),
    { date: '2026-10-01', precision: 'estimated' });
});

test('CSV quotes review text and preserves metadata columns', () => {
  const result = csv([{ club_id: 'club', review_id: 'r1', rating: 5,
    published_at: '2026-09-15', text: 'Great, "clean" place', date_precision: 'estimated' }]);
  assert.match(result, /"Great, ""clean"" place"/);
  assert.match(result, /published_label,date_precision/);
});

test('incremental refresh stops after a run of existing reviews', () => {
  const collected = new Map(), seen = new Set(), known = new Set(['a', 'b', 'c']);
  let streak = recordFreshCards([{ review_id: 'new' }, { review_id: 'a' }], collected, seen, known);
  assert.equal(streak, 1);
  streak = recordFreshCards([{ review_id: 'a' }, { review_id: 'b' }, { review_id: 'c' }], collected, seen, known, streak);
  assert.equal(streak, 3);
  assert.equal(collected.size, 4);
  streak = recordFreshCards([{ review_id: 'later' }], collected, seen, known, streak);
  assert.equal(streak, 0);
});

test('Maps navigation retries one transient timeout', async () => {
  let attempts = 0;
  const page = {
    goto: async () => { if (++attempts === 1) throw new Error('Timeout 45000ms exceeded'); },
    waitForTimeout: async () => {},
  };
  await gotoMaps(page, 'https://www.google.com/maps/');
  assert.equal(attempts, 2);
});

test('a failed refresh is eligible for Collect missing', () => {
  assert.equal(shouldSkipClub({ complete: true }, true, false), true);
  assert.equal(shouldSkipClub({ complete: true, last_error: 'timeout' }, true, false), false);
});
