import test from "node:test";
import assert from "node:assert/strict";

import { getAnalysisActivityLabel } from "../src/lib/analysis-status";

test("queued and retrying jobs are not labeled as running", () => {
  assert.equal(getAnalysisActivityLabel("NOT_STARTED", "QUEUED"), "Analysis queued");
  assert.equal(getAnalysisActivityLabel("NOT_STARTED", "RETRY"), "Analysis queued");
  assert.equal(getAnalysisActivityLabel("NOT_STARTED", null), "Analysis queued");
});

test("running jobs are labeled as running", () => {
  assert.equal(getAnalysisActivityLabel("RUNNING", "RUNNING"), "Analysis running");
  assert.equal(getAnalysisActivityLabel("RUNNING", null), "Analysis running");
});
