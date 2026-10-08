# Reproducible ML research pipeline

This is a research-only, raw-function inference pipeline. The worker now
consumes it only as a separate investigative signal; deterministic findings,
evidence, and risk remain authoritative and unchanged.

## Environment and dependencies

The notebook records Python 3.12.10. Use Python 3.11 or 3.12 and install its
exact dependency versions from this directory:

```powershell
py -3.11 -m venv ml\.venv
.\ml\.venv\Scripts\Activate.ps1
python -m pip install -r ml\requirements.txt
```

`requirements.txt` captures the notebook's direct data, plotting, ML, and
inference dependencies and pins the versions needed by the training and
inference entry points.

## Reproduce training and evaluation

From the repository root:

```powershell
python -m ml.training.train
```

The command reads the checked-in `ml/training/bugzero_dataset.csv` and refuses
to train if its stored project-grouped split no longer matches the notebook's
first `StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=42)` fold.
It tunes `C` only with 5-fold `GroupKFold` on the training projects. It prints
**TRAIN/CV METRICS** separately from **HELD-OUT TEST METRICS**; the test split
is never used to select model settings. CV metrics from the selected `C` are
descriptive because the same training folds select `C`.

Code preprocessing and embedding match the notebook: collapse whitespace,
tokenize with the pinned CodeBERT revision, truncate at 512 tokens, and mean
pool the final hidden states using the attention mask. The classifier remains
`StandardScaler` plus class-balanced logistic regression.

## Artifact and inference contract

Training writes `ml/artifacts/v1/metadata.json`, `scaler.joblib`, and
`classifier.joblib`. The serialized files contain only the small sklearn
inference components; CodeBERT weights are fetched from the pinned revision
`3b0952feddeffad0063f274080e3c23d75e7eb39` on first use and cached by
Hugging Face. No encoder weights or generated embeddings are committed.

Inference accepts a single non-empty Python function source string of at most
64 KiB UTF-8. Optional `function_metadata` must be a mapping of at most 32
items and 4 KiB of JSON; metadata is accepted for caller context but is not a model feature.
Metadata values must be scalar JSON values. Inputs exceeding limits raise
`CodeInputError`. Missing/incomplete artifacts
raise `ModelArtifactError` with a training command.

```powershell
python -m ml.inference.predict "def read_file(path):`n    return open(path).read()"
```

It prints JSON containing `model_version`, `label` (`safe` or `vulnerable`),
and `score` (probability for the vulnerable class).

The worker uses the same module in JSON-lines mode, loading the encoder once
per analysis and processing each bounded function as a separate request:

```powershell
python -m ml.inference.predict --jsonl
```

Signals are persisted separately in the existing analysis-run coverage at
`coverage.pipeline.mlSignals`; the worker does not write ML output to Finding,
Evidence, or RiskAssessment records. An unavailable model is reported as
`UNAVAILABLE` in that field and does not change analysis completion.

## Tests

After training and making the pinned CodeBERT revision available:

```powershell
python -m unittest discover -s ml\tests -v
```

The inference artifact is expected to stay Git-trackable because it contains
only the fitted scaler, logistic-regression coefficients, and JSON metadata.
The much larger pretrained encoder remains an external, revision-pinned
download.
