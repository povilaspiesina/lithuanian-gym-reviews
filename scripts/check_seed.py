"""Verify the bundled starter archive can be opened as a SQLite database."""

import gzip
import shutil
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path


with tempfile.TemporaryDirectory() as folder:
    database = Path(folder) / "reviews.sqlite3"
    with gzip.open(sys.argv[1], "rb") as source, database.open("wb") as destination:
        shutil.copyfileobj(source, destination)
    with closing(sqlite3.connect(database)) as con:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        count = con.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
    if integrity != "ok" or count < 1:
        raise SystemExit(f"Invalid starter archive: {integrity}, {count} reviews")
    print(f"Starter archive: {count} reviews, integrity OK")
