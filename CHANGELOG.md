# Release notes

Add a `## vX.Y.Z` section before creating each version tag. The Windows release workflow publishes that section as the GitHub release description.

## v1.9.5

### Added
- Overview compares completed months, quarters, and years for the selected gyms, including review volume, average rating, low-star share, owner replies, period changes, and CSV export.
- AI answers use short comment references. Select a reference to read the full archived comment and owner reply in the same view.
- Desktop Settings groups Maps collection, local data, AI connection, and app updates in a dedicated window.

### Changed
- Custom date fields keep a reserved place in the filter bar, so switching periods no longer moves other filters. Dates after tomorrow are rejected in both the form and API.
- Built-in analysis prompts ask for distinct, relevant findings backed by specific comments. Internal review IDs are no longer sent to the model.

## v1.9.4

### Added
- Named AI prompts can be created from built-in examples, edited, copied, and deleted. They are saved in the local review database.
- Reviews & AI offers Qwen 2.5 7B, GPT-OSS 20B, GPT-OSS 120B, and a custom Hugging Face model ID, plus English or Lithuanian answer language.
- AI review scope can be a balanced sample or all matching complete written comments. Full analysis processes comments in batches, shows progress, and combines batch summaries; it can take many minutes and consume substantial inference credits.
- Manual update checks show a small progress window. The Windows app also checks automatically on launch and every 12 hours while it remains open.

### Changed
- AI answers render as formatted Markdown with unsafe HTML removed. Substantial Chinese output is rewritten in English when English is selected; the app reports a clear model error if a rewrite still ignores that language choice.
- Overview and Reviews & AI are adjacent in navigation and share filter choices when switching. Collection now holds the club coverage metrics and details.
- Average rating trend lines connect rated periods across gaps in the data.
- The sample analysis status clearly distinguishes comments analyzed from all eligible comments.

## v1.9.3

### Changed
- The From and To date fields in Overview and Reviews & AI now appear only when the period is set to Custom dates.
- Switching to a preset period hides and disables the date fields without changing the selected dates, so they are available if you switch back.

## v1.9.2

### Added
- The Windows app can download changed installer blocks for future updates when available. GitHub releases include the required update manifest and block map.

### Fixed
- Hugging Face API requests identify the app to avoid Cloudflare rejecting Python urllib's default user agent. Cloudflare 1010 errors now show a short explanation.
- The Windows build verifies the bundled updater using Windows path separators. Earlier v1.9.0 and v1.9.1 build checks failed before publishing installers.

### Upgrade note
- v1.8.0 downloads v1.9.2 as a full installer once. Later updates can use differential downloads; a full download remains the fallback.

## v1.9.1

No installer was published for this tag because the Windows metadata verification check failed. The changes are included in v1.9.2.

### Added
- Windows updates can reuse unchanged installer blocks when a differential download is available, with progress shown in the app. Releases include the update manifest and block map.

### Fixed
- Hugging Face API requests now identify this app. A direct probe showed Python urllib's default user agent gets Cloudflare 1010 from Groq, while the app-identifying header reaches the API.
- Provider Cloudflare 1010 responses display a short actionable message.
- Corrected the Windows build's metadata verification check, which prevented v1.9.0 from publishing.

### Upgrade note
- v1.8.0 downloads v1.9.1 as a full installer once. Later updates can use differential downloads when supported; the updater falls back to a full installer when needed.

## v1.9.0

The Windows build for this tag failed its metadata verification step, so no v1.9.0 installer was published. Its planned changes are included in v1.9.1.

### Added
- Windows updates can download only changed installer blocks when differential download is available. The update prompt shows progress and installs the result from within the app.
- GitHub releases now include the Windows update manifest and block map needed for differential updates.

### Fixed
- Hugging Face requests now identify the app instead of using Python urllib's default user agent, which Groq's Cloudflare blocked with HTTP 403 / error 1010 in a direct unauthenticated probe.
- If a provider still returns Cloudflare 1010, the app shows a short actionable error rather than an HTML page.

### Changed
- This version is the transition from the previous full-installer updater. Existing v1.8.0 installations download v1.9.0 once in full; later releases can use differential downloads.
- If differential download cannot be used, the updater falls back to the full installer so the update can still complete.

## v1.8.0

### Added
- Review analysis defaults to Qwen/Qwen2.5-7B-Instruct through Featherless AI on Hugging Face.
- Translation has its own model setting and continues to default to openai/gpt-oss-120b.

### Fixed
- The app routes the unsuffixed Qwen2.5-7B-Instruct model ID to its active Hugging Face provider.
- If Featherless AI is disabled for the account, the app explains what to enable instead of showing a raw HTTP 400 error.

## v1.7.0

### Added
- Release notes now describe changes in each version, with the same notes shown on GitHub releases.

### Fixed
- Update checks and installer downloads no longer ask for a GitHub token now that the repository is public.
- The first-launch update flow no longer interrupts users with private repository setup.

## v1.6.0

### Added
- Windows app checks for newer releases on launch and offers to download and open the installer. A manual check is available under Tools.
- Installer downloads are checked against the release asset size and SHA-256 digest.
- Automated updater tests, a test plan, and a GitHub Actions source test gate were added.

### Changed
- This version used a repository-scoped GitHub token because the repository was private when it was released. v1.7.0 removes that requirement.

## v1.5.0

### Added
- Focused AI analysis prompts for issues, practical fixes, billing, strengths, owner replies, recent reviews, comparisons, and management briefs.
- Reviewer names are shown and included in analysis data even for rating-only entries when Maps provides them.

### Improved
- AI prompts can be edited before running and provide more useful context for recurring analysis tasks.

## v1.4.0

### Added
- Per-review translation to English or Lithuanian, including owner replies, with a local cache.
- Warnings for saved review text that still ends in a shortened “More” preview.

### Fixed
- Collector expands review and owner-reply text more reliably and preserves previously saved full text during later refreshes.
- Review links point to individual Maps reviews when a direct link is available.

## v1.3.0

### Added
- Collection dashboard with club-level progress, data quality, and completion status.
- Controls to target clubs needing attention and a compact summary of archive freshness.

### Fixed
- Collection failures remain visible so a club can be retried instead of appearing complete.

## v1.2.0

### Added
- Desktop workspace with separate overview, collection, and review analysis views, filters, charts, CSV export, and a collapsible activity log.
- More resilient collection controls, including sign-in flow, stopping after a club, and configurable collector window size.

### Fixed
- A failed incremental refresh can be resumed and the affected club remains eligible for collection.

## v1.1.0

### Added
- Bundled starter archive and review analytics, including rating distribution, trends, and chain comparisons.
- Windows build smoke tests for the packaged dashboard, collector, browser, and seed data.

### Fixed
- Incremental refresh keeps a club eligible when newest-sort controls are unavailable.
- Seed database files close cleanly during Windows build cleanup.

## v1.0.0

### Added
- Initial local desktop app for collecting Lithuanian Gym+, Lemon Gym, and SportGates reviews from Google Maps.
- Self-contained Windows installer and ZIP built on GitHub Actions; includes the dashboard, collector runtime, and Chromium.
- Local SQLite storage, review import/export, and a gym directory for collection.

### Fixed
- Imported CSV clubs are marked as unverified until their Maps review coverage is checked.
