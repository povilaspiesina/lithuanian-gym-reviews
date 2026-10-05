import csv
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from review_app import connect, export_club_csv, filters, import_csv, review_data, stats


class ReviewAppTests(unittest.TestCase):
    def test_import_is_repeatable_and_filters_reviews(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "reviews.csv"
            with source.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=[
                    "club_id", "review_id", "rating", "published_at", "text",
                    "author", "owner_reply_text",
                ])
                writer.writeheader()
                writer.writerows([
                    {"club_id": "gym-vilnius-mokslininku-g-6a", "review_id": "a", "rating": 5,
                     "published_at": "2026-09-12", "text": "Clean gym", "author": "A", "owner_reply_text": "Thanks"},
                    {"club_id": "gym-vilnius-mokslininku-g-6a", "review_id": "b", "rating": 2,
                     "published_at": "2026-08-01", "text": "Crowded", "author": "B"},
                    {"club_id": "lem on", "review_id": "c", "rating": 3,
                     "published_at": "2026-09-14", "text": "Other"},
                ])
            with closing(connect(root / "reviews.sqlite3")) as con:
                with self.assertRaisesRegex(ValueError, "CSV line 4: unknown club_id"):
                    import_csv(con, source)
                self.assertEqual(stats(con, {})["review_count"], 0)
                with source.open(encoding="utf-8") as file:
                    rows = list(csv.DictReader(file))
                rows.pop()
                with source.open("w", newline="", encoding="utf-8") as file:
                    writer = csv.DictWriter(file, fieldnames=rows[0].keys())
                    writer.writeheader()
                    writer.writerows(rows)
                self.assertEqual(import_csv(con, source)[0], 2)
                self.assertEqual(import_csv(con, source)[0], 2)
                self.assertEqual(stats(con, {})["review_count"], 2)
                params = {"period": ["custom"], "start": ["2026-09-01"],
                          "end": ["2026-09-30"], "rating": ["5"], "q": ["clean"]}
                self.assertEqual(stats(con, params)["review_count"], 1)
                self.assertEqual(review_data(con, params)[0]["review_id"], "a")
                exported = root / "all-club-reviews.csv"
                self.assertEqual(export_club_csv(con, "gym-vilnius-mokslininku-g-6a", exported), 2)
                with exported.open(newline="", encoding="utf-8") as file:
                    self.assertEqual({row["review_id"] for row in csv.DictReader(file)}, {"a", "b"})


if __name__ == "__main__":
    unittest.main()
