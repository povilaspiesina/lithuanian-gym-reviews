import csv
import io
import json
import os
import tempfile
import unittest
import urllib.error
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from review_app import ask_hugging_face, chart_csv, chart_data, connect, coverage_data, export_club_csv, hugging_face_chat, import_csv, review_data, routed_model, stats, translate_review


class ReviewAppTests(unittest.TestCase):
    def test_qwen_routes_to_featherless_and_explains_disabled_provider(self):
        model = routed_model("Qwen/Qwen2.5-7B-Instruct")
        self.assertEqual(model, "Qwen/Qwen2.5-7B-Instruct:featherless-ai")
        detail = json.dumps({"error": {"code": "model_not_supported"}}).encode()
        error = urllib.error.HTTPError("https://router.huggingface.co/v1/chat/completions", 400,
                                       "Bad Request", {}, io.BytesIO(detail))
        with patch("review_app.urllib.request.urlopen", side_effect=error):
            with self.assertRaisesRegex(ValueError, "Enable Featherless AI"):
                hugging_face_chat({"model": model, "messages": []}, "hf_fake")

    def test_hugging_face_rejects_cut_off_output(self):
        incomplete = io.BytesIO(json.dumps({"choices": [{"message": {"content": "partial"},
                                                     "finish_reason": "length"}]}).encode())
        with patch("review_app.urllib.request.urlopen", return_value=incomplete):
            with self.assertRaisesRegex(ValueError, "output limit"):
                hugging_face_chat({"model": "example", "messages": []}, "hf_fake")

    def test_translation_caches_full_review_and_reply(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            club = "gym-vilnius-mokslininku-g-6a"
            source = root / "reviews.csv"
            comment = ("Clean gym. " * 80).strip()
            with source.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=["club_id", "review_id", "rating", "published_at", "text", "owner_reply_text"])
                writer.writeheader()
                writer.writerow({"club_id": club, "review_id": "full", "rating": 5, "published_at": "2026-10-01",
                                 "text": comment, "owner_reply_text": "Thank you for visiting."})
            with closing(connect(root / "reviews.sqlite3")) as con:
                import_csv(con, source)
                replies = [io.BytesIO(json.dumps({"choices": [{"message": {"content": text}, "finish_reason": "stop"}]}).encode())
                           for text in ("Švari sporto salė.", "Ačiū, kad apsilankėte.")]
                with patch.dict(os.environ, {"HF_TOKEN": "hf_fake"}), patch("review_app.urllib.request.urlopen", side_effect=replies) as request:
                    first = translate_review(con, club, "full", "lt", "openai/gpt-oss-120b:cheapest")
                    second = translate_review(con, club, "full", "lt", "openai/gpt-oss-120b:cheapest")
                self.assertEqual(first["text"], "Švari sporto salė.")
                self.assertEqual(first["reply"], "Ačiū, kad apsilankėte.")
                self.assertFalse(first["cached"])
                self.assertTrue(second["cached"])
                self.assertEqual(request.call_count, 2)
                body = json.loads(request.call_args_list[0].args[0].data)
                self.assertEqual(body["messages"][1]["content"], comment)
                self.assertEqual(con.execute("SELECT text FROM reviews WHERE review_id='full'").fetchone()[0], comment)
                with source.open("w", newline="", encoding="utf-8") as file:
                    writer = csv.DictWriter(file, fieldnames=["club_id", "review_id", "rating", "published_at", "text", "owner_reply_text"])
                    writer.writeheader()
                    writer.writerow({"club_id": club, "review_id": "full", "rating": 5, "published_at": "2026-10-01",
                                     "text": "Clean … More", "owner_reply_text": "Thank … More"})
                import_csv(con, source)
                saved = con.execute("SELECT text, owner_reply_text FROM reviews WHERE review_id='full'").fetchone()
                self.assertEqual(tuple(saved), (comment, "Thank you for visiting."))
                ai_response = io.BytesIO(json.dumps({"choices": [{"message": {"content": "Positive feedback."}, "finish_reason": "stop"}]}).encode())
                with patch.dict(os.environ, {"HF_TOKEN": "hf_fake"}), patch("review_app.urllib.request.urlopen", return_value=ai_response) as request:
                    ask_hugging_face(con, {}, "Summarize", "openai/gpt-oss-120b:cheapest", "summary")
                ai_body = json.loads(request.call_args.args[0].data)
                self.assertIn(comment, ai_body["messages"][1]["content"])

    def test_coverage_distinguishes_missing_unknown_and_failed_scans(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first = "gym-vilnius-mokslininku-g-6a"
            second = "gym-vilnius-gedimino-pr-9"
            third = "lemon-gym-didzioji-riese-moletu-g-13"
            report = root / "scrape-report.json"
            report.write_text(json.dumps({
                first: {"displayed_review_count": 3, "scraped_at": "2026-10-01T10:00:00Z"},
                second: {"displayed_review_count": None, "scraped_at": "2026-10-01T11:00:00Z"},
                third: {"displayed_review_count": 1, "last_error": "Maps timed out", "scraped_at": "2026-10-01T12:00:00Z"},
            }), encoding="utf-8")
            source = root / "reviews.csv"
            source.write_text("club_id,review_id,rating,published_at,text,date_precision\n"
                              f"{first},a,4,2026-09-01,Good,estimated\n"
                              f"{second},b,3,2026-09-02,Okay,exact\n", encoding="utf-8")
            with closing(connect(root / "reviews.sqlite3")) as con, patch("review_app.REPORT", report):
                import_csv(con, source)
                result = coverage_data(con)
            self.assertEqual(result["missing_known"], 3)
            self.assertEqual(result["clubs"][first]["state"], "partial")
            self.assertEqual(result["clubs"][second]["state"], "unverified")
            self.assertIsNone(result["clubs"][second]["missing"])
            self.assertEqual(result["clubs"][third]["state"], "error")
            self.assertEqual(result["date_quality"], {"estimated": 1, "exact": 1})

    def test_shortened_text_needs_collection_even_when_counts_match(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            club = "gym-vilnius-mokslininku-g-6a"
            source = root / "reviews.csv"
            source.write_text("club_id,review_id,rating,published_at,text\n"
                              f"{club},a,4,2026-10-01,Short … More\n", encoding="utf-8")
            report = root / "scrape-report.json"
            report.write_text(json.dumps({club: {"displayed_review_count": 1, "complete": True,
                                                 "scraped_at": "2026-10-01T10:00:00Z"}}), encoding="utf-8")
            with closing(connect(root / "reviews.sqlite3")) as con, patch("review_app.REPORT", report):
                import_csv(con, source)
                coverage = coverage_data(con)
            self.assertEqual(coverage["clubs"][club]["state"], "shortened")
            self.assertFalse(coverage["clubs"][club]["complete"])
            self.assertEqual(coverage["shortened_reviews"], 1)

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
                self.assertEqual(stats(con, {"reply": ["replied"]})["review_count"], 1)
                self.assertEqual(stats(con, {"reply": ["unreplied"]})["review_count"], 1)
                charts = chart_data(con, {})
                charts["ratings"] = stats(con, {})["ratings"]
                self.assertIn("average_rating", chart_csv(charts, "volume").decode("utf-8-sig"))
                self.assertIn("club", chart_csv(charts, "clubs").decode("utf-8-sig"))
                with patch.dict(os.environ, {"HF_TOKEN": "hf_fake"}):
                    fake = io.BytesIO(json.dumps({"choices": [{"message": {"content": "Crowding is cited [b]."}}]}).encode())
                    with patch("review_app.urllib.request.urlopen", return_value=fake) as request:
                        answer = ask_hugging_face(con, {}, "What issues recur?", "openai/gpt-oss-120b:cheapest", "issues")
                    self.assertEqual(answer["sampled"], 1)
                    self.assertIn("Crowding", answer["answer"])
                    self.assertEqual(request.call_args.args[0].get_header("Authorization"), "Bearer hf_fake")
                    prompt_body = json.loads(request.call_args.args[0].data)
                    self.assertIn('"author": "B"', prompt_body["messages"][1]["content"])
                with patch.dict(os.environ, {"HF_TOKEN": "hf_fake"}):
                    response = io.BytesIO(json.dumps({"choices": [{"message": {"content": "A replied."}}]}).encode())
                    with patch("review_app.urllib.request.urlopen", return_value=response) as request:
                        ask_hugging_face(con, {}, "Assess replies", "openai/gpt-oss-120b:cheapest", "summary")
                    prompt_body = json.loads(request.call_args.args[0].data)
                    self.assertIn('"author": "A"', prompt_body["messages"][1]["content"])
                    self.assertIn('"owner_reply": "Thanks"', prompt_body["messages"][1]["content"])
                with patch.dict(os.environ, {"HF_TOKEN": "hf_fake"}):
                    response = io.BytesIO(json.dumps({"choices": [{"message": {"content": "Issues summarized."}}]}).encode())
                    with patch("review_app.urllib.request.urlopen", return_value=response) as request:
                        answer = ask_hugging_face(con, {}, "Summarize", "Qwen/Qwen2.5-7B-Instruct", "summary")
                    self.assertEqual(answer["model"], "Qwen/Qwen2.5-7B-Instruct:featherless-ai")
                    self.assertEqual(json.loads(request.call_args.args[0].data)["model"], answer["model"])
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
