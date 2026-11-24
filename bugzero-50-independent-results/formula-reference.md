# Formula reference

Score calculations use the immutable `profile_snapshot`, persisted assessment inputs, and persisted health-dimension `inputMetrics` from each real run. No formulas or fixture labels were modified.

## Risk Score

`clamp(severityBase[severity] + sum(adjustments[dimension][persisted_input]), 0, 100)`

The script recomputes each persisted Risk Assessment and separately compares the authenticated finding API values. An absent assessment is not scored as zero.

## Health Score

For each scored dimension, the persisted severity penalty is applied to persisted technical-risk inputs and rounded/clamped to 0–100. Overall Health Score is the rounded weighted mean over dimensions with persisted scores only:

`round(sum(dimension_score * configured_weight) / sum(configured_weight for scored dimensions))`

A `PARTIAL` snapshot or run remains partial even when its available-dimension arithmetic matches. Health API values are compared to the persisted snapshot for the same run.
