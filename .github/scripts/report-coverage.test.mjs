import test from "node:test";
import assert from "node:assert/strict";
import { formatCoverage, summarizeCoverage } from "./report-coverage.mjs";

const counters = (covered, total) => Object.fromEntries(
  ["statements", "branches", "functions", "lines"].map((metric) => [metric, { covered, total }]),
);

test("summary weights files by counters and ignores global totals and other packages", () => {
  const result = summarizeCoverage({
    total: counters(100, 100),
    "/repo/debug/src/a.ts": counters(1, 1),
    "/repo/debug/src/b.ts": counters(1, 3),
    "/repo/extension/src/a.ts": counters(100, 100),
  }, "/repo");
  assert.deepEqual(result.debug.lines, { covered: 2, total: 4 });
  assert.match(formatCoverage(result), /debug \| 50\.00%/);
  assert.match(formatCoverage(result), /ui \| No data/);
});

test("summary reports the newly measured language services separately from their analysis packages", () => {
  const result = summarizeCoverage({
    "/repo/language-servers/wgsl/src/backend.ts": counters(9, 10),
    "/repo/language-servers/wgsl-analysis/src/parser.ts": counters(8, 10),
  }, "/repo");
  assert.deepEqual(result["language-servers/wgsl"].lines, { covered: 9, total: 10 });
  assert.deepEqual(result["language-servers/wgsl-analysis"].lines, { covered: 8, total: 10 });
  assert.match(formatCoverage(result), /language-servers\/wgsl \| 90\.00%/);
});
