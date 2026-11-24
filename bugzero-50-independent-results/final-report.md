# Post-fix audit report

The final post-fix audit completed 48/48 independent repository analysis runs. A preceding 48-run pass exposed three simple safe Python SQL forms that were unnecessarily marked PARTIAL; after a focused regression fix, all 48 fixtures were rerun. Thus 96 fixture-run executions completed across the two full batches, and these result files describe the final batch.

- Jobs: 48 completed; 0 failed/dead-letter.
- Analysis: 31 COMPLETED; 17 PARTIAL.
- Classification: 5 detected; 4 correctly safe; 39 unsupported/partial; 0 missed; 0 persistence failures; 0 unverified.
- Health arithmetic/API: 48/48 independent matches; 48/48 API matches.
- Risk arithmetic/API: 5/5 independent matches; 5/5 API matches. Missing assessments were not treated as zero.

The six remaining vulnerable-labelled cases classified as unsupported/partial are `case_002`, `case_012`, `case_013`, `case_026`, `case_031`, and `case_041`. Their diagnostics and full evidence are recorded per case in `results.json`. Five vulnerable fixtures produced persisted findings and Risk Assessments. Health score agreement verifies arithmetic against saved inputs only; PARTIAL coverage is not a security certification.
