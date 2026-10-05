"""Create the versioned starter archive from this machine's local review data."""

import gzip
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path


root = Path(__file__).resolve().parent.parent
source = root / "data" / "reviews.sqlite3"
report = root / "data" / "scrape-report.json"
target = root / "seed"
target.mkdir(exist_ok=True)
temporary = target / "reviews.sqlite3.tmp"

with closing(sqlite3.connect(source)) as original, closing(sqlite3.connect(temporary)) as snapshot:
    original.backup(snapshot)
with temporary.open("rb") as input_file, (target / "reviews.sqlite3.gz").open("wb") as output_file:
    with gzip.GzipFile(fileobj=output_file, mode="wb", mtime=0) as compressed:
        shutil.copyfileobj(input_file, compressed)
temporary.unlink()
shutil.copyfile(report, target / "scrape-report.json")
print(f"Saved starter archive in {target}")
