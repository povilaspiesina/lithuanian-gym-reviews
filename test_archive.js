const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { installStarterArchive } = require('./desktop/archive');

test('an update keeps the existing review database and saved prompts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-archive-'));
  try {
    const destination = path.join(root, 'user-data');
    const database = path.join(destination, 'reviews.sqlite3');
    const seed = path.join(root, 'reviews.sqlite3.gz');
    const report = path.join(root, 'scrape-report.json');
    fs.mkdirSync(destination);
    fs.writeFileSync(database, 'existing database including saved prompts');
    fs.writeFileSync(seed, zlib.gzipSync('new bundled starter archive'));
    fs.writeFileSync(report, '{"new":"coverage"}');
    assert.equal(installStarterArchive(destination, seed, report), false);
    assert.equal(fs.readFileSync(database, 'utf8'), 'existing database including saved prompts');
    assert.equal(fs.existsSync(path.join(destination, 'scrape-report.json')), false);
    fs.rmSync(database);
    assert.equal(installStarterArchive(destination, seed, report), true);
    assert.equal(fs.readFileSync(database, 'utf8'), 'new bundled starter archive');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
