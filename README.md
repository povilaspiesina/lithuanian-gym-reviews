# Lithuanian Gym Reviews

## Windows desktop app

Download the Windows installer (`.exe`) from this repository's **Releases** page. The installer includes the dashboard, its Python runtime, the collector's Node runtime, and a Chromium browser. No separate Python, Node, Chrome, or npm installation is needed on the Windows computer. The ZIP is a portable alternative; extract the whole folder before running the app. The Windows build is for x64 PCs.

The app starts with an empty local archive. Click **Collect missing** to scrape the 68 open clubs, or **Import CSV** to bring over reviews exported from another installation. **Maps sign-in** is available if Google Maps asks for an account. The collector opens one separate browser window while it runs. **Stop after this club** saves what it has collected from the current club before stopping. **Refresh all** revisits completed clubs to collect new reviews. Use **Data folder** to find the database, CSV files, browser profile, and coverage report; these stay on the local computer.

To transfer this Mac's review archive to Windows, export **All time** reviews from the dashboard as CSV and import that file in the Windows app. The GitHub release does not include the private local review database. Relative dates supplied by Google Maps remain estimates, so date filters are approximate for those rows.

### Build a Windows download on GitHub

The private repository's `Build Windows app` workflow can be started from the **Actions** tab. It uploads an installer and ZIP as a workflow artifact. Pushing a version tag such as `v1.0.0` also creates a Release with those files. GitHub Actions downloads Chromium and packages it during the build; the Windows user only downloads the finished app. The unsigned installer may show a Windows SmartScreen warning.

For development on macOS, run `npm ci` and `npm start`. This uses the local Python 3 interpreter and a visible browser. The package build itself runs on GitHub's Windows runner because PyInstaller must build a Windows executable on Windows.

## Gym club directory

`gyms_lt.json` is the base list for matching Google Maps businesses before collecting reviews. It contains 72 locations listed by the three chains on 2026-10-01: 41 Gym+, 20 Lemon Gym, and 11 SportGates.

Each record has a stable local `id`, chain, club name, address, operating status, official source URL, and a `google_maps_search_query`. `google_place_id` is `null` until the correct Google Maps listing has been verified. Difficult Gym+ matches have place IDs from the chain's [Google review links](https://gymplius.lt/g-reviews/); several other IDs were matched by address from [SportHub's venue directory](https://sporthub.lt/venues) and checked in Maps. A search query is a candidate, not a confirmed Maps place.

The official pages identify 68 clubs as open, one Gym+ club at Viršuliškių g. 40 as renovating, and three clubs as coming soon. Review collection should start with `status == "open"`; match each record to a Google place ID and manually check ambiguous results before collecting reviews. Club status can change, so refresh the directory before a long scrape.

Sources:

- Gym+: https://gymplius.lt/apie-mus/klubai/
- Lemon Gym: https://www.lemongym.lt/klubai/
- SportGates: https://sportgates.lt/kontaktai/

Run `python3 build_gym_directory.py` to regenerate the JSON from the curated source rows. The script needs only the Python standard library.

## Local review dashboard

The dashboard uses SQLite locally and needs no Python packages or cloud hosting. Collected reviews are saved under the ignored `data/` directory on this machine.

1. Put your review data in a CSV with the header in `reviews_template.csv`. Use each club's `id` from `gyms_lt.json` as `club_id`. Required columns are `club_id`, `rating` (1–5), `published_at` (ISO date), and `text` (blank for rating-only reviews). The other columns are optional. A stable `review_id` is recommended; if absent, one is generated from review content.
2. Run `python3 review_app.py import-csv /absolute/path/to/reviews.csv`.
3. Run `python3 review_app.py serve` and open `http://127.0.0.1:8765`.

The interface filters by all time, last 30 days, previous calendar month, custom dates, chain, city, club, star rating, and text in reviews or owner replies. It shows review count, average rating, reply count, rating distribution, a paginated review list, and a filtered CSV export. Reimporting the same review IDs updates existing rows rather than duplicating them. The database is saved at `data/reviews.sqlite3` and is ignored by Git. Use `python3 review_app.py status` to check its review count.

## Local Google Maps collector

Install its browser automation dependency once with `npm install`. It uses Google Chrome installed on this Mac and creates a separate persistent browser profile in `data/maps-browser-profile`.

1. Run `node maps_scraper.js login` and sign in to Google Maps in the opened browser. Press Enter in the terminal when reviews are visible.
2. Try one club: `node maps_scraper.js run --club gym-vilnius-gedimino-pr-9 --max-reviews 20`.
3. After that works, run `node maps_scraper.js run --all` to process every club marked `open`.

Use `node maps_scraper.js status` to see per-club coverage. A later `run --all` skips complete clubs. Add `--retry` to recheck completed clubs as well. Run the collector with its default visible browser mode; Google Maps did not expose review cards in the headless test session. Keep the separate scraper Chrome window open until the command finishes.

For targeted retries, use `node maps_scraper.js run --clubs ID1,ID2` to process several clubs in one browser tab. The default keeps one Chrome window open throughout the batch. If Chrome crashes or the window is closed, the batch stops after saving its collected reviews; it does not open another window. `--restart-every N` explicitly opts into periodic browser restarts. Add `--sort newest`, `--sort highest`, or `--sort lowest` to try a different Maps review order. `--lite` blocks images and media if a listing is heavy. A single club can be limited for a trial with `--max-reviews 20`.

The collector searches Maps from the club directory. When several listings match, it asks you to pick the correct one and saves the chosen URL in `data/maps-place-urls.json`. It scrolls the review list, expands visible review text, writes one CSV per club under `data/`, and imports those rows into the dashboard. Rerunning updates rows by review ID, then rebuilds the club CSV from all rows held in SQLite. A failed club gets a `data/debug_<club_id>.png` screenshot and the run continues.

Google Maps may show only relative review dates such as “2 months ago.” The collector estimates a date for these and labels it `date_precision=estimated`; date filters using those rows are approximate. Review list loading and selectors can change, and a run may retrieve fewer than the displayed review count. The dashboard coverage card and `data/scrape-report.json` record this difference. Check coverage per club before using the output as a complete historical dataset.

Google Places API returns no more than five reviews per club. The full-history Google Business Profile review API requires access to verified business locations. Google Maps Platform terms restrict scraping and saving Maps reviews, including for EEA customers. Review those terms before running the browser collector.
