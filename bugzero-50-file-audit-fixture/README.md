# BugZero 50-File Audit & ML Evaluation Fixture

This archive contains exactly 50 files:
- 48 source-code cases under `cases/`
- `README.md`
- `labels.json` with expected behaviors and caveats

## Purpose
Use this as a repeatable evaluation set for BugZero's parser, Code IR, deterministic analyzers, ML inference, evidence, and health pipeline. Cases deliberately vary language, source/sink shape, safe controls, syntax errors, and quality/correctness patterns.

## Important limitations
- This does **not** train or update a model by itself. It is a labeled evaluation fixture. Training requires a separate training pipeline and should use a proper train/validation/test split.
- Do not treat `expected_behavior` as proof that BugZero supports that category. Entries marked `UNSUPPORTED_OR_DEFERRED`, `UNSUPPORTED_OR_RULE_LIMIT`, or `*_OR_RULE_LIMIT` are capability probes, not guaranteed positives.
- The currently implemented BugZero security rules may support only a limited subset of Python/TypeScript SQL injection patterns. Check actual analyzer coverage before treating a missed result as an ML failure.
- The target score is not hardcoded. A repository with all test cases is not expected to receive exactly 0/100; the score must be produced by real findings and the current health formula.
- Several files are intentionally syntactically invalid or contain correctness/quality issues. They should test graceful handling, not cause fabricated security findings.
- Fake secret values are inert placeholders, not real credentials.
- Do not deploy this code. It is for local testing only.

## Recommended evaluation
1. Upload as a new local ZIP repository and run analysis.
2. Confirm the run is COMPLETED and inspect parser/analyzer/ML statuses.
3. Compare each finding against `labels.json`, source location, evidence, and analyzer support.
4. Calculate precision/recall only on categories the system claims to support.
5. Keep unsupported categories separate from false negatives.
6. Use separate train/validation/test sets when retraining; never evaluate on training samples.
