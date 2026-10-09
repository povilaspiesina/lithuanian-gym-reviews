const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function installStarterArchive(destination, seed, report) {
  const database = path.join(destination, 'reviews.sqlite3');
  if (fs.existsSync(database) || !fs.existsSync(seed)) return false;
  fs.mkdirSync(destination, { recursive: true });
  const temporary = database + '.tmp';
  try {
    fs.writeFileSync(temporary, zlib.gunzipSync(fs.readFileSync(seed)));
    fs.renameSync(temporary, database);
    if (fs.existsSync(report)) fs.copyFileSync(report, path.join(destination, 'scrape-report.json'));
    return true;
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

module.exports = { installStarterArchive };
