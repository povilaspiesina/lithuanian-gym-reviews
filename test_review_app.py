import csv
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from review_app import chart_data, connect, export_club_csv, import_csv, review_data, stats


class ReviewAppTests(unittest.TestCase):
    def test_written_comment_filter_and_charts_share_the_same_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "reviews.csv"
            with source.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=["club_id", "review_id", "rating", "published_at", "text"])
                writer.writeheader()
                writer.writerows([
                    {"club_id": "gym-vilnius-mokslininku-g-6a", "review_id": "written", "rating": 1,
                     "published_at": "2026-09-01", "text": "Crowded"},
                    {"club_id": "gym-vilnius-mokslininku-g-6a", "review_id": "stars", "rating": 5,
                     "published_at": "2026-09-02", "text": ""},
                ])
            with closing(connect(root / "reviews.sqlite3")) as con:
                import_csv(con, source)
                for comment, expected_id, expected_rating in (("written", "written", 1), ("rating_only", "stars", 5)):
                    params = {"comment": [comment]}
                    self.assertEqual(stats(con, params)["review_count"], 1)
                    self.assertEqual(stats(con, params)["average_rating"], expected_rating)
                    self.assertEqual(review_data(con, params)[0]["review_id"], expected_id)
                    self.assertEqual(chart_data(con, params)["chains"][0]["count"], 1)

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
                self.assertEqual(stats(con, {})["written_count"], 2)
                self.assertEqual(stats(con, {})["low_rating_count"], 1)
                self.assertEqual(stats(con, {"comment": ["written"]})["review_count"], 2)
                self.assertEqual(stats(con, {"comment": ["rating_only"]})["review_count"], 0)
                self.assertEqual(chart_data(con, {})["clubs"][0]["average_rating"], 3.5)
                self.assertEqual(chart_data(con, {})["trend"][0]["period"], "2026-08-01")
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
