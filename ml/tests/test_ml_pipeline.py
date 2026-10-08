from __future__ import annotations

import unittest

from ml.inference.predict import (
    DEFAULT_ARTIFACT_DIR,
    MAX_SOURCE_BYTES,
    CodeInputError,
    ModelArtifactError,
    VulnerabilityPredictor,
)

VALID_FUNCTION = """def read_config(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()
"""

SAFE_FUNCTION = """def add_tax(price, rate):
    if price < 0 or rate < 0:
        raise ValueError("price and rate must be non-negative")
    return price * (1 + rate)
"""

VULNERABLE_LOOKING_FUNCTION = """def render_profile(name):
    from flask import request
    return "<h1>" + request.args.get("name", name) + "</h1>"
"""


class InferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not (DEFAULT_ARTIFACT_DIR / "metadata.json").is_file():
            raise unittest.SkipTest(
                "Train the v1 model before running inference integration tests."
            )
        cls.predictor = VulnerabilityPredictor()

    def test_artifact_exists_and_loads(self) -> None:
        for name in ("metadata.json", "scaler.joblib", "classifier.joblib"):
            self.assertTrue((DEFAULT_ARTIFACT_DIR / name).is_file(), name)
        self.assertEqual(self.predictor.metadata["model_version"], "v1")

    def test_valid_python_function_returns_structured_result(self) -> None:
        result = self.predictor.predict(VALID_FUNCTION)
        self.assertEqual(set(result), {"model_version", "label", "score"})
        self.assertIn(result["label"], {"safe", "vulnerable"})
        self.assertGreaterEqual(result["score"], 0.0)
        self.assertLessEqual(result["score"], 1.0)

    def test_safe_function_inference(self) -> None:
        result = self.predictor.predict(SAFE_FUNCTION)
        self.assertIn(result["label"], {"safe", "vulnerable"})
        self.assertIsInstance(result["score"], float)

    def test_vulnerable_looking_function_inference(self) -> None:
        result = self.predictor.predict(VULNERABLE_LOOKING_FUNCTION)
        self.assertIn(result["label"], {"safe", "vulnerable"})
        self.assertIsInstance(result["score"], float)

    def test_empty_and_malformed_input(self) -> None:
        for source in ("", " \n\t"):
            with self.subTest(source=repr(source)):
                with self.assertRaises(CodeInputError):
                    self.predictor.predict(source)
        with self.assertRaises(CodeInputError):
            self.predictor.predict(None)  # type: ignore[arg-type]

    def test_oversized_input_is_rejected_before_embedding(self) -> None:
        with self.assertRaisesRegex(CodeInputError, "65536-byte"):
            self.predictor.predict("x" * (MAX_SOURCE_BYTES + 1))

    def test_same_input_is_deterministic_and_returns_version(self) -> None:
        first = self.predictor.predict(VALID_FUNCTION)
        second = self.predictor.predict(VALID_FUNCTION)
        self.assertEqual(first["model_version"], "v1")
        self.assertEqual(first, second)


class MissingArtifactTests(unittest.TestCase):
    def test_missing_artifact_has_actionable_error(self) -> None:
        missing_dir = DEFAULT_ARTIFACT_DIR / "does-not-exist"
        with self.assertRaisesRegex(ModelArtifactError, "python -m ml.training.train"):
            VulnerabilityPredictor(missing_dir)


if __name__ == "__main__":
    unittest.main()
