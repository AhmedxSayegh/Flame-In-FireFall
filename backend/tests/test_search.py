import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import requests

import gemini_client as gc
import pipeline as pl

# Flask tests mock mode and disable dotenv loading before importing the app.
with patch("dotenv.load_dotenv"):
    import app as web


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.invs = pl.load_investigations()
        cls.query = json.loads((web.DEMO / "demo_query.json").read_text("utf-8"))
        cls.demo = json.loads((web.DEMO / "demo_output.json").read_text("utf-8"))

    def test_ranking_and_membership_are_authoritative(self):
        scores = pl.prescore_all(self.invs, self.query)
        first = self.invs[0]
        allowed = pl.candidate_sets(first["record"], self.query)
        eid = allowed[0]["set_id"]
        item = {
            "psi_id": first["psi_id"], "rank": 9, "relevance_score": 5,
            "field_matches": {"fuel_type": "no match"},
            "top_experiments": [
                {"experiment_id": "PSI-69-CS56"},
                {"experiment_id": eid, "rank": 3, "tests": [{"test_number": "wrong"}],
                 "summary_of_key_findings": "Invented report-wide rate of 99 mm/s",
                 "fire_safety_interpretation": "Every run had 99 mm/s.",
                 "evidence": ["bogus p. 200"]},
                {"experiment_id": eid},
            ],
            "top_experiments_comparison": {"experiment_ids": ["wrong"]},
        }
        result, notes = pl.ground_output(
            {**self.demo, "ranked": [{"psi_id": "UNKNOWN"}, item, item]},
            self.invs, self.query, ["records"], scores,
        )
        self.assertFalse(pl.validate_output(result))
        self.assertEqual([r["psi_id"] for r in result["ranked"]], [s["psi_id"] for s in scores])
        for rank, (row, score) in enumerate(zip(result["ranked"], scores), 1):
            self.assertEqual((row["rank"], row["relevance_score"], row["field_matches"]),
                             (rank, score["score"], score["field_matches"]))
        row = result["ranked"][0]
        exps = row["top_experiments"]
        self.assertEqual([e["rank"] for e in exps], [1, 2, 3])
        self.assertEqual(exps[0]["tests"], allowed[0]["tests"])
        self.assertNotIn("99 mm/s", json.dumps(exps))
        self.assertNotIn("bogus", json.dumps(exps))
        self.assertEqual(row["top_experiments_comparison"]["experiment_ids"],
                         [e["experiment_id"] for e in exps])
        self.assertTrue(notes)

    def test_bass_report_claim_scope_and_physical_pages(self):
        result, _ = pl.ground_output(self.demo, self.invs, self.query, [], saved=True)
        bass = next(row for row in result["ranked"] if row["psi_id"] == "PSI-25")
        evidence = {e["page"]: e for e in bass["report_evidence"]}
        self.assertEqual(evidence[21]["test_numbers"], [])
        self.assertEqual(evidence[114]["test_numbers"], ["P13a", "P13b"])
        self.assertTrue(evidence[121]["url"].endswith(".pdf#page=121"))
        summary, _ = pl.ground_output({"ranked": []}, self.invs, self.query, [])
        for selected in summary["ranked"][0]["top_experiments"]:
            self.assertNotIn("2.2 mm/s", selected["summary_of_key_findings"])

    def test_raw_measurements_and_missing_conditions(self):
        flex, bass = ("PSI-69-CS14", "PSI-25-CS18")
        records = {r["experiment_id"]: r for r in pl.experiment_records(self.invs, [flex, bass])}
        self.assertTrue(all(t["airflow_cm_s"] is None and t["pressure_kpa"] is None
                            for t in records[bass]["tests"]))
        self.assertEqual([t["test_number"] for t in records[bass]["tests"]], ["P13a", "P13b"])
        rates = [m for t in records[flex]["tests"] for m in t["measurements"] if m["quantity"] == "burning_rate"]
        self.assertTrue(rates)
        self.assertEqual({m["unit"] for m in rates}, {"unconfirmed"})
        result, _ = pl.ground_output(self.demo, self.invs, self.query, [], saved=True)
        flex_row = next(row for row in result["ranked"] if row["psi_id"] == "PSI-69")
        findings = " ".join(e["summary_of_key_findings"] for e in flex_row["top_experiments"])
        self.assertIn("physical unit unconfirmed", findings)
        self.assertIn("3/4 runs", findings)
        self.assertNotIn("mm²/s", findings)
        query = {**self.query, "conditions": {"airflow_cm_s": 5}}
        self.assertTrue(all(s["field_matches"]["airflow"].startswith("unknown")
                            for s in pl.prescore_all(self.invs, query)))

    def test_prompt_is_small_and_only_contains_valid_candidates(self):
        schema = pl.gemini_schema()
        self.assertNotIn("query", schema["properties"])
        item = schema["properties"]["ranked"]["items"]["properties"]
        self.assertNotIn("relevance_score", item)
        for inv in self.invs:
            raw = pl.compact_record(inv["record"], self.query)
            self.assertLess(len(raw), 8_000)
            compact = json.loads(raw)
            self.assertNotIn("tests", compact)
            self.assertEqual([c["set_id"] for c in compact["condition_sets"]],
                             [c["set_id"] for c in pl.candidate_sets(inv["record"], self.query)])

    def test_report_budget_and_failed_extraction_tracking(self):
        pages = "[page 1]\n" + "Other " * 1000 + "\n[page 21]\n" + "Results " * 1000
        excerpt = pl.select_report_pages(pages, self.query, 1200, (21,))
        self.assertLessEqual(len(excerpt), 1200)
        self.assertTrue(excerpt.startswith("[page 21]\n"))
        with patch.object(gc, "pdf_text", side_effect=[pages, OSError()]):
            parts, used = gc.report_parts(self.invs, "text", Mock(), self.query, time.monotonic() + 10)
        self.assertEqual(used, ["PSI-25/reports/BASS-II_Summary_Report.pdf"])
        self.assertIn("[page 21]", parts[1]["text"])


class GeminiTests(unittest.TestCase):
    def test_transient_errors_and_fallback_share_a_three_request_budget(self):
        with patch.object(gc, "_headers", return_value={}), patch.object(
            gc.requests, "post", side_effect=requests.Timeout
        ) as post, patch.dict(gc.os.environ, {"GEMINI_FALLBACK_MODEL": "backup"}):
            with self.assertRaises(gc.GeminiError):
                gc.generate("primary", "prompt", [], {}, Mock(), time.monotonic() + 10)
        self.assertEqual(post.call_count, 3)
        self.assertIn("primary:", post.call_args_list[0].args[0])
        self.assertIn("backup:", post.call_args_list[1].args[0])
        self.assertTrue(all(c.kwargs["timeout"] <= 10 for c in post.call_args_list))

    def test_schema_modes_are_bounded_and_cached_per_model(self):
        accepted = Mock(status_code=200)
        accepted.json.return_value = {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
        rejected = Mock(status_code=400, text="unsupported schema")
        with patch.object(gc, "_headers", return_value={}), patch.object(
            gc.requests, "post", side_effect=[rejected, accepted, accepted, accepted]
        ) as post, patch.dict(gc._working_modes, clear=True):
            for model in ("first", "first", "other"):
                gc.generate(model, "prompt", [], {}, Mock(), time.monotonic() + 10)
        configs = [c.kwargs["json"]["generationConfig"] for c in post.call_args_list]
        self.assertIn("responseFormat", configs[0])
        self.assertIn("responseJsonSchema", configs[1])
        self.assertIn("responseJsonSchema", configs[2])
        self.assertIn("responseFormat", configs[3])

    def test_blank_optional_settings_do_not_prevent_generation(self):
        accepted = Mock(status_code=200)
        accepted.json.return_value = {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
        with patch.object(gc, "_headers", return_value={}), patch.object(
            gc.requests, "post", return_value=accepted
        ) as post, patch.dict(gc.os.environ, {
            "GEMINI_MAX_OUTPUT_TOKENS": "", "GEMINI_TIMEOUT_S": " ",
        }):
            gc.generate("model", "prompt", [], {}, Mock(), time.monotonic() + 60)
        self.assertEqual(post.call_args.kwargs["json"]["generationConfig"]["maxOutputTokens"], 4096)
        self.assertEqual(post.call_args.kwargs["timeout"], 30)

    def test_repair_is_one_request_and_has_input_limit(self):
        with patch.object(gc, "_headers", return_value={}), patch.object(
            gc.requests, "post", return_value=Mock(status_code=503)
        ) as post:
            with self.assertRaises(gc.GeminiError):
                gc.repair("model", "{}", ["bad"], {}, Mock(), time.monotonic() + 10)
            with self.assertRaises(gc.GeminiError):
                gc.repair("model", "a" * (gc.REPAIR_MAX_CHARS + 1), [], {}, Mock(), time.monotonic() + 10)
            with self.assertRaises(gc.GeminiError):
                gc.generate("model", "prompt", [], {}, Mock(), time.monotonic() - 1)
        post.assert_called_once()


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = web.app.test_client()
        self.query = json.loads((web.DEMO / "demo_query.json").read_text("utf-8"))

    def test_saved_example_delivers_records_and_supports_pdf_range(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(web, "RUNS", Path(temp)), patch.object(
            web, "has_key", return_value=False
        ):
            response = self.client.post("/api/search", json={"input": {**self.query, "fuel_type": "Liquid Fuels"}})
        self.assertEqual(response.status_code, 200)
        body = response.json
        self.assertTrue(body["meta"]["valid"])
        self.assertFalse(body["meta"]["query_matches_example"])
        self.assertEqual(body["output"]["query"], self.query)
        ids = {e["experiment_id"] for r in body["output"]["ranked"] for e in r["top_experiments"]}
        self.assertEqual({record["experiment_id"] for record in body["records"]}, ids)
        report = self.client.get("/api/reports/PSI-25/BASS-II_Summary_Report.pdf",
                                 headers={"Range": "bytes=0-4"})
        with report:
            self.assertEqual(report.status_code, 206)
            self.assertEqual(report.data, b"%PDF-")
        self.assertEqual(self.client.get("/api/reports/PSI-69/BASS-II_Summary_Report.pdf").status_code, 404)

    def test_invalid_repair_fails_as_upstream_error_and_unlocks(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(web, "RUNS", Path(temp)), patch.object(
            web, "has_key", return_value=True
        ), patch.object(gc, "generate", return_value=("[]", "test", {}, "test")) as gen, patch.object(
            gc, "repair", return_value=("{}", "test", {}, "test")
        ) as repair:
            response = self.client.post("/api/search", json={"input": self.query, "report_mode": "none"})
        self.assertEqual(response.status_code, 502)
        self.assertIn("after one repair", response.json["error"])
        gen.assert_called_once()
        repair.assert_called_once()
        self.assertFalse(web.BUSY.locked())

    def test_invalid_query_payload_does_not_call_gemini(self):
        with patch.object(gc, "generate") as generate:
            response = self.client.post("/api/search", json=["invalid"])
        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
