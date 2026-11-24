import test from "node:test";
import assert from "node:assert/strict";

import { sortNewestFirst } from "../src/lib/analysis-order";

test("sortNewestFirst orders completed analyses by their timestamps, not API order", () => {
  const analyses = [
    { id: "older", completedAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T09:00:00.000Z" },
    { id: "latest", completedAt: "2026-02-01T10:00:00.000Z", createdAt: "2026-02-01T09:00:00.000Z" },
    { id: "in-progress", completedAt: null, createdAt: "2026-03-01T09:00:00.000Z" },
  ];

  assert.deepEqual(
    sortNewestFirst(analyses.filter((analysis) => analysis.completedAt !== null), (analysis) => analysis.completedAt)
      .map((analysis) => analysis.id),
    ["latest", "older"],
  );
});

test("sortNewestFirst preserves stable order for invalid or equal timestamps", () => {
  const items = [
    { id: "first", date: "invalid" },
    { id: "second", date: "invalid" },
    { id: "newest", date: "2026-03-01T00:00:00.000Z" },
  ];

  assert.deepEqual(sortNewestFirst(items, (item) => item.date).map((item) => item.id), [
    "newest",
    "first",
    "second",
  ]);
});
