# Test plan

Run `npm ci`, `npm test`, and `python -m unittest -q test_review_app.py` locally. Every push to `main` and pull request runs these source tests on GitHub Actions. A version tag runs the same tests, then builds and smoke tests the packaged Windows app before publishing its release.

## Automated scenarios

| Area | Scenario | Expected result | Test |
| --- | --- | --- | --- |
| Updates | Newer stable release, same version, older release, malformed tag | Prompt only for a newer stable version | `test_updater.js` |
| Updates | Private repository rejects token | Clear access error without exposing token | `test_updater.js` |
| Updates | Installer missing, prerelease, or missing digest | No download or installation | `test_updater.js` |
| Updates | Asset URL redirects to GitHub CDN | Token stays on GitHub API request | `test_updater.js` |
| Updates | Complete download, short download, wrong checksum, foreign redirect | Only a verified installer is kept | `test_updater.js` |
| Collector | Transient Maps timeout | One retry, then a recorded failure if still unavailable | `test_maps_scraper.js` |
| Collector | Previously saved full text later appears shortened | Full text remains in archive | `test_maps_scraper.js` |
| Collector | Refresh sees known reviews | Stops at the configured boundary | `test_maps_scraper.js` |
| Collector | Failed run | Club remains eligible for Collect gaps | `test_maps_scraper.js` |
| Dashboard | CSV import, filters, chart series, coverage, author and reply | Correct persisted values and aggregates | `test_review_app.py` |
| AI | Translation cache and summary limits | Saved translation reused, output bounded | `test_review_app.py` |
| Package | Windows backend, browser, seed, collector CLI | All start from bundled release files | `windows-app.yml` smoke step |

## Windows acceptance scenarios

These use real GitHub releases and Google Maps, so keep them manual until test accounts and a dedicated fixture repository exist.

1. Install an older release, add a fine-grained token scoped to `povilaspiesina/lithuanian-gym-reviews` with **Contents: read**, restart, and confirm that the newer version prompt appears. Choose **Later**, restart, then choose **Download and install**. Confirm the installer opens and the existing review archive is still present after installation.
2. Remove the GitHub token. Confirm update checks offer setup. Enter an expired token and confirm the error is understandable and contains no token text. Restore a valid token and confirm **Check for updates** works.
3. Start a collection and check for updates. Confirm the app asks to finish collecting first. Interrupt network access during the next check or download; confirm the current version still opens and no partial installer is offered.
4. Sign in to Maps, collect a club with long review and owner reply, and confirm full text, author, reply, coverage, and refresh behavior. Disconnect during collection; confirm it can later resume from saved data.
5. In Analytics and Reviews, exercise filters, sorting, chart hover, CSV export, translation, and AI summaries with a small known data set. Compare exported counts against the on-screen values.

For release testing, use a disposable Windows profile and a repository-scoped token. Never put a personal token in test fixtures, logs, or CI secrets unless a dedicated integration test specifically needs it.
