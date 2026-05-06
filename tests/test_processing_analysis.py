import unittest

import numpy as np
import pandas as pd

from api._processing import (
    _apply_qsf_recode_labels,
    _normalize_qualtrics_recode_key,
)
from api.survey_logic import (
    build_validation_summary,
    compute_struct_score,
    symptom_frequency_score,
)


class ProcessingAnalysisTests(unittest.TestCase):
    def test_normalize_qualtrics_recode_key_handles_float_csv_cells(self):
        """May exports parsed as float must match QSF maps keyed by '6', not '6.0'."""
        self.assertEqual(_normalize_qualtrics_recode_key(6.0), "6")
        self.assertEqual(_normalize_qualtrics_recode_key(np.float64(1.0)), "1")
        self.assertEqual(_normalize_qualtrics_recode_key(7), "7")
        self.assertEqual(_normalize_qualtrics_recode_key(" Like "), "Like")

    def test_apply_qsf_recode_labels_numeric_cells(self):
        df = pd.DataFrame(
            {
                "QID195_1": [6.0, 1.0, "Like"],
                "Headache": [5.0, np.nan, "weekly"],
            }
        )
        qid_map = {"QID195_1": 0, "Headache": 1}
        _apply_qsf_recode_labels(df, qid_map)
        self.assertEqual(df["QID195_1"].tolist(), ["Like", "Dislike", "Like"])
        self.assertTrue(pd.isna(df["Headache"].iloc[1]))
        self.assertEqual(df["Headache"].iloc[0], "Never or rarely")
        self.assertEqual(df["Headache"].iloc[2], "weekly")

    def test_struct_score_counts_critical_condition(self):
        score = compute_struct_score({
            "QID192": "Before 1960",
            "QID128": "Single Wide Mobile Home",
            "QID141": "Critical- Uninhabitable without repairs.",
        })
        self.assertGreaterEqual(score, 90)

    def test_symptom_frequency_annually(self):
        self.assertEqual(symptom_frequency_score("annually"), 1)
        self.assertEqual(symptom_frequency_score("Annual"), 1)
        self.assertEqual(symptom_frequency_score("once per year"), 1)

    def test_validation_summary_contract_fields(self):
        iaq_features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-82.0, 29.8]},
                "properties": {
                    "street_name": "Oak St",
                    "coord_source": "address_matched",
                    "iaq_matched": True,
                },
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-82.001, 29.801]},
                "properties": {
                    "street_name": "Pine St",
                    "coord_source": "geocoded",
                    "iaq_matched": False,
                },
            },
        ]
        contact_features = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-82.0, 29.8]},
                "properties": {"status": "Completed"},
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-82.005, 29.805]},
                "properties": {"status": "No Answer"},
            },
        ]

        v = build_validation_summary(iaq_features, contact_features)
        for key in (
            "total_iaq_responses",
            "total_completed_contacts",
            "matched_iaq_responses",
            "match_rate_pct",
            "coverage_pct",
            "unmatched_iaq",
            "match_details",
            "unmatched_by_street",
        ):
            self.assertIn(key, v)
        self.assertEqual(v["total_iaq_responses"], 2)
        self.assertEqual(v["matched_iaq_responses"], 1)
        self.assertEqual(v["unmatched_iaq"], 1)
        self.assertEqual(v["total_completed_contacts"], 1)
        self.assertEqual(v["match_rate_pct"], 50.0)
        self.assertEqual(v["coverage_pct"], 100.0)
        self.assertEqual(v["unmatched_by_street"].get("Pine St"), 1)

if __name__ == "__main__":
    unittest.main()
