"""Extract one version's notes from CHANGELOG.md for a GitHub release."""

import re
import sys
from pathlib import Path


def notes_for(tag: str, changelog: str) -> str:
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError(f"Invalid version tag: {tag}")
    heading = re.search(rf"(?m)^## {re.escape(tag)}\s*$", changelog)
    if not heading:
        raise ValueError(f"No {tag} section in CHANGELOG.md")
    next_heading = re.search(r"(?m)^## v\d+\.\d+\.\d+\s*$", changelog[heading.end():])
    end = heading.end() + next_heading.start() if next_heading else len(changelog)
    body = changelog[heading.start():end].strip()
    if not re.search(r"(?m)^### (Added|Fixed|Changed|Improved)$", body) or len(body.splitlines()) < 4:
        raise ValueError(f"{tag} release notes are incomplete")
    return body + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: release_notes.py vX.Y.Z OUTPUT_FILE")
    try:
        notes = notes_for(sys.argv[1], Path("CHANGELOG.md").read_text(encoding="utf-8"))
    except ValueError as error:
        raise SystemExit(str(error)) from error
    Path(sys.argv[2]).write_text(notes, encoding="utf-8")
