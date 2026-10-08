# Release notes

Add a `## vX.Y.Z` section before creating each version tag. The Windows release workflow publishes that section as the GitHub release description.

## v1.9.0

### Added
- Windows updates can download only changed installer blocks when differential download is available. The update prompt shows progress and installs the result from within the app.
- GitHub releases now include the Windows update manifest and block map needed for differential updates.

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
