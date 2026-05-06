import json
import unittest
from pathlib import Path

from api.survey_logic import QID141_RECODE_LABELS


class QsfAlignmentTests(unittest.TestCase):
    def test_qid141_mapping_contains_critical_option(self):
        self.assertIn("5", QID141_RECODE_LABELS)
        self.assertIn("critical", QID141_RECODE_LABELS["5"].lower())

    def test_qid141_qsf_contains_critical_choice(self):
        qsf_path = Path(
            "/Users/goshtasbshahriari/UF Dropbox/Goshtasb Shahriari Mehr/DTSC_Lab/Keystone_Data/Keystone_Heights_Survey_-_V1 (1).qsf"
        )
        if not qsf_path.exists():
            self.skipTest("QSF file not found on this machine")

        obj = json.loads(qsf_path.read_text())
        qid141 = None
        for el in obj.get("SurveyElements", []):
            if el.get("Element") == "SQ" and el.get("PrimaryAttribute") == "QID141":
                qid141 = el.get("Payload", {})
                break

        self.assertIsNotNone(qid141, "QID141 was not found in QSF")
        choices = qid141.get("Choices", {})
        self.assertIn("5", choices)
        self.assertIn("critical", choices["5"]["Display"].lower())


if __name__ == "__main__":
    unittest.main()
