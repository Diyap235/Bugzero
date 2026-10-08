"""Run the versioned CodeBERT research model on one Python function."""

from __future__ import annotations

import argparse
import json
import pickle
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import joblib
import torch

from ml.common import (
    FEATURE_DIMENSION,
    MODEL_ID,
    MODEL_REVISION,
    embed_codes,
    load_encoder,
)

DEFAULT_ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "v1"
MAX_SOURCE_BYTES = 64 * 1024
MAX_METADATA_ITEMS = 32


class ModelArtifactError(RuntimeError):
    """Raised when a model artifact is absent or invalid."""


class CodeInputError(ValueError):
    """Raised for invalid or oversized function source."""


class VulnerabilityPredictor:
    def __init__(self, artifact_dir: Path = DEFAULT_ARTIFACT_DIR) -> None:
        metadata_path = artifact_dir / "metadata.json"
        scaler_path = artifact_dir / "scaler.joblib"
        classifier_path = artifact_dir / "classifier.joblib"
        missing = [
            path.name
            for path in (metadata_path, scaler_path, classifier_path)
            if not path.is_file()
        ]
        if missing:
            raise ModelArtifactError(
                f"Model artifact is incomplete at {artifact_dir}: missing "
                + ", ".join(missing)
                + ". Generate it with `python -m ml.training.train`."
            )
        try:
            self.metadata: dict[str, Any] = json.loads(
                metadata_path.read_text(encoding="utf-8")
            )
            self.scaler = joblib.load(scaler_path)
            self.classifier = joblib.load(classifier_path)
        except (OSError, ValueError, pickle.UnpicklingError, EOFError, ImportError, AttributeError) as exc:
            raise ModelArtifactError(f"Could not load model artifact at {artifact_dir}: {exc}") from exc

        if (
            self.metadata.get("encoder", {}).get("model_id") != MODEL_ID
            or self.metadata.get("encoder", {}).get("revision") != MODEL_REVISION
            or self.metadata.get("encoder", {}).get("feature_dimension") != FEATURE_DIMENSION
            or self.metadata.get("label_mapping") != {"safe": 0, "vulnerable": 1}
        ):
            raise ModelArtifactError(f"Unsupported or incompatible model metadata in {metadata_path}.")
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer, self.encoder = load_encoder(self.device)

    def predict(
        self,
        source: str,
        function_metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, str | float]:
        self._validate_request(source, function_metadata)
        embedding = embed_codes(
            [source],
            self.tokenizer,
            self.encoder,
            self.device,
        )
        if embedding.shape != (1, FEATURE_DIMENSION):
            raise ModelArtifactError(
                f"Encoder returned unexpected feature shape {embedding.shape}."
            )
        scaled = self.scaler.transform(embedding)
        score = float(self.classifier.predict_proba(scaled)[0, 1])
        return {
            "model_version": str(self.metadata["model_version"]),
            "label": "vulnerable" if score >= float(self.metadata["inference_threshold"]) else "safe",
            "score": score,
        }

    @staticmethod
    def _validate_request(
        source: str,
        function_metadata: Mapping[str, Any] | None,
    ) -> None:
        if not isinstance(source, str) or not source.strip():
            raise CodeInputError("Function source must be a non-empty string.")
        try:
            source_bytes = source.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise CodeInputError("Function source must be valid UTF-8 text.") from exc
        if len(source_bytes) > MAX_SOURCE_BYTES:
            raise CodeInputError(
                f"Function source exceeds the {MAX_SOURCE_BYTES}-byte limit."
            )
        if function_metadata is not None:
            if not isinstance(function_metadata, Mapping):
                raise CodeInputError("function_metadata must be a mapping when provided.")
            if len(function_metadata) > MAX_METADATA_ITEMS:
                raise CodeInputError(
                    f"function_metadata may contain at most {MAX_METADATA_ITEMS} items."
                )
            if any(
                not isinstance(key, str)
                or not isinstance(value, (str, int, float, bool, type(None)))
                for key, value in function_metadata.items()
            ):
                raise CodeInputError(
                    "function_metadata must map string keys to scalar JSON values."
                )
            try:
                metadata_size = len(
                    json.dumps(
                        dict(function_metadata),
                        ensure_ascii=False,
                        allow_nan=False,
                    ).encode("utf-8")
                )
            except (TypeError, ValueError) as exc:
                raise CodeInputError("function_metadata must contain JSON-compatible values.") from exc
            if metadata_size > 4096:
                raise CodeInputError("function_metadata must not exceed 4096 UTF-8 bytes.")


def predict(
    source: str,
    function_metadata: Mapping[str, Any] | None = None,
    artifact_dir: Path = DEFAULT_ARTIFACT_DIR,
) -> dict[str, str | float]:
    return VulnerabilityPredictor(artifact_dir).predict(source, function_metadata)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", help="Python function source; omit to read stdin.")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument(
        "--jsonl",
        action="store_true",
        help="Serve one JSON request per stdin line and one prediction per stdout line.",
    )
    args = parser.parse_args()
    if args.jsonl:
        predictor = VulnerabilityPredictor(args.artifact_dir)
        for line in sys.stdin:
            request = json.loads(line)
            if not isinstance(request, dict) or not isinstance(request.get("source"), str):
                raise CodeInputError("Each JSONL request must contain a source string.")
            result = predictor.predict(request["source"], request.get("metadata"))
            print(json.dumps(result, separators=(",", ":")), flush=True)
        return
    source = args.source if args.source is not None else sys.stdin.read()
    print(json.dumps(VulnerabilityPredictor(args.artifact_dir).predict(source), indent=2))


if __name__ == "__main__":
    main()
