# Lithuanian Gym Reviews

## Windows desktop app

Download the Windows installer (`.exe`) from this repository's **Releases** page. The installer includes the dashboard, its Python runtime, the collector's Node runtime, and a Chromium browser. No separate Python, Node, Chrome, or npm installation is needed on the Windows computer. The ZIP is a portable alternative; extract the whole folder before running the app. The Windows build is for x64 PCs.

The release includes a starter archive of 17,793 reviews collected through 2026-10-05. On first launch, it copies that archive into the app's local data folder. Existing local databases are never replaced by an app update. The first launch prompts for Google Maps sign-in in the separate collector browser. Click **Collect missing** for clubs with incomplete coverage, or **Import CSV** to bring over newer reviews from another installation. **Stop after this club** saves what it has collected from the current club before stopping. **Refresh all** checks newest reviews first and stops after 30 consecutive previously saved review IDs for clubs whose prior history was complete; incomplete clubs still receive a full pass. The collector window can be resized by dragging it, and the toolbar sets its initial size for the next run. Use **Data folder** to find the database, CSV files, browser profile, and coverage report.

The **Collection** tab shows club status (complete, partial, error, not checked, or coverage unknown), the saved count beside Maps' displayed total, the last check time, and any recorded error. It refreshes while collection runs and identifies the club currently being scanned. You can retry one club or all clubs needing attention from this tab. The progress bar counts verified clubs, not elapsed time. A missing Maps total is shown as **Unknown**; it is not treated as zero. The Overview also states how many archived review dates are estimates, so time charts and date filters can be interpreted accordingly.

To transfer changes made after the starter archive was created, export **All time** reviews from one installation and import that CSV into the other. Review IDs prevent duplicates. Relative dates supplied by Google Maps remain estimates, so date filters and time charts are approximate for those rows. The starter archive lives in this private repository under `seed/`; run `python3 scripts/create_seed.py` on the source computer to regenerate it before publishing a newer release.

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

The app has separate **Overview**, **Collection**, and **Reviews & AI** sections. Overview and Reviews & AI each have their own filters. Filter by all time, last 30 days, previous calendar month, custom dates, chain, city, club, star rating, written comment, owner reply, and text in reviews or replies. Overview shows counts, averages, reply rates, interactive charts, club comparisons, and coverage. Hover charts for exact values; export each chart or the sorted club table as an Excel-readable CSV. The review section shows written comments and owner replies; rating-only entries show just the club and stars. Export filtered reviews as CSV. Collector activity is collapsed at the bottom of the desktop window. The toolbar shows the last Maps check and completion numbers. Reimporting the same review IDs updates existing rows rather than duplicating them. The database is saved at `data/reviews.sqlite3` and is ignored by Git. Use `python3 review_app.py status` to check its review count.

### Hugging Face analysis

In the desktop toolbar, click **Hugging Face token** and enter a [fine-grained token with Inference Providers permission](https://huggingface.co/docs/inference-providers/index#authentication). The token is encrypted with the operating system's secure storage and is not added to the repository or CSV exports. In **Reviews & AI**, select filters, then choose **Main issues**, **Review summary**, or **Custom question**. The app sends a capped sample of matching written reviews to the [Hugging Face chat completion API](https://huggingface.co/docs/inference-providers/tasks/chat-completion) only when you click Analyze; the response displays how many comments were sampled out of the eligible set. You can change the model ID. Hugging Face requests may use [monthly credits or paid usage](https://huggingface.co/docs/inference-providers/pricing). No inference happens during scraping or ordinary dashboard browsing.

## Local Google Maps collector

Install its browser automation dependency once with `npm install`. It uses Google Chrome installed on this Mac and creates a separate persistent browser profile in `data/maps-browser-profile`.

1. Run `node maps_scraper.js login` and sign in to Google Maps in the opened browser. Press Enter in the terminal when reviews are visible.
2. Try one club: `node maps_scraper.js run --club gym-vilnius-gedimino-pr-9 --max-reviews 20`.
3. After that works, run `node maps_scraper.js run --all` to process every club marked `open`.

Use `node maps_scraper.js status` to see per-club coverage. A later `run --all` skips complete clubs. Add `--retry` to recheck completed clubs as well. Run the collector with its default visible browser mode; Google Maps did not expose review cards in the headless test session. Keep the separate scraper Chrome window open until the command finishes.

For targeted retries, use `node maps_scraper.js run --clubs ID1,ID2` to process several clubs in one browser tab. The default keeps one Chrome window open throughout the batch. If Chrome crashes or the window is closed, the batch stops after saving its collected reviews; it does not open another window. `--restart-every N` explicitly opts into periodic browser restarts. Add `--sort newest`, `--sort highest`, or `--sort lowest` to try a different Maps review order. `--lite` blocks images and media if a listing is heavy. A single club can be limited for a trial with `--max-reviews 20`.

For quicker updates, use `node maps_scraper.js run --all --retry --incremental`. On clubs marked complete, this sorts by newest and stops after 30 consecutive stored review IDs; new and recently updated reviews are still imported. Clubs marked incomplete retain the full multi-sort collection. This is a recent-review check, so occasionally run a full retry without `--incremental` if you need to audit older edits or coverage.

If Maps navigation stalls, the collector retries once. It records the affected club and a debug screenshot if the attempt still fails, then pauses the batch after three consecutive failures or incomplete scans. Saved reviews remain in SQLite. Check sign-in and connectivity before restarting; **Collect missing** resumes incomplete clubs, while **Refresh all** rechecks completed clubs.

The collector searches Maps from the club directory. When several listings match, it asks you to pick the correct one and saves the chosen URL in `data/maps-place-urls.json`. It scrolls the review list, expands visible review text, writes one CSV per club under `data/`, and imports those rows into the dashboard. Rerunning updates rows by review ID, then rebuilds the club CSV from all rows held in SQLite. A failed club gets a `data/debug_<club_id>.png` screenshot and the run continues.

Google Maps may show only relative review dates such as “2 months ago.” The collector estimates a date for these and labels it `date_precision=estimated`; date filters using those rows are approximate. Review list loading and selectors can change, and a run may retrieve fewer than the displayed review count. The dashboard coverage card and `data/scrape-report.json` record this difference. Check coverage per club before using the output as a complete historical dataset.

Google Places API returns no more than five reviews per club. The full-history Google Business Profile review API requires access to verified business locations. Google Maps Platform terms restrict scraping and saving Maps reviews, including for EEA customers. Review those terms before running the browser collector.
