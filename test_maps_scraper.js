const assert = require('node:assert/strict');
const test = require('node:test');
const { dateFromLabel, csv } = require('./maps_scraper');

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
