import test from "node:test";
import assert from "node:assert/strict";
import { checkNewFileCoverage, isRuntimeSource, formatNewFileCoverage } from "./check-new-file-coverage.mjs";

const coverage = (pct = 100) => Object.fromEntries(
  ["statements", "branches", "functions", "lines"].map((metric) => [metric, { covered: pct, total: 100, pct }]),
);
const source = (file) => file.endsWith("Types.ts") ? "export interface Config { value: string }" : "export function value() { return 1; }";

test("new runtime modules require measured coverage; types, tests and generated modules are exempt", () => {
  const result = checkNewFileCoverage({}, ["language-servers/wgsl/src/new.ts", "rendering/src/Types.ts", "ui/src/test/new.test.ts", "ui/src/slang/vendor.ts", "types/src/generated/new.ts"], "/repo", source);
  assert.equal(result.files.length, 1);
  assert.deepEqual(result.errors, ["language-servers/wgsl/src/new.ts: missing unit coverage"]);
  assert.equal(isRuntimeSource("ui/src/view.svelte", "<p>Hello</p>"), true);
  assert.equal(isRuntimeSource("types/src/types.d.ts", "export declare const value: number"), false);
});

test("each new file must clear every metric independently of package averages", () => {
  const low = coverage();
  low.branches = { covered: 1, total: 10, pct: 10 };
  const result = checkNewFileCoverage({ "/repo/rendering/src/new.ts": low, "/repo/rendering/src/old.ts": coverage() }, ["rendering/src/new.ts"], "/repo", source);
  assert.match(result.errors[0], /branches 10\.00% < 80%/);
  assert.equal(result.errors.length, 1);
});

test("uses counters rather than trusting rounded percentages and treats no branches as fully covered", () => {
  const exact = coverage();
  exact.lines = { covered: 89999, total: 100000, pct: 90 };
  exact.branches = { covered: 0, total: 0, pct: 100 };
  const result = checkNewFileCoverage({ "/repo/debug/src/new.ts": exact }, ["debug/src/new.ts"], "/repo", source);
  assert.match(result.errors[0], /lines .* < 90%/);
  assert.equal(result.errors.length, 1);
});

test("zero counters cannot count as coverage for executable source", () => {
  const empty = Object.fromEntries(Object.keys(coverage()).map((metric) => [metric, { covered: 0, total: 0, pct: 100 }]));
  const result = checkNewFileCoverage({ "/repo/rendering/src/new.ts": empty }, ["rendering/src/new.ts"], "/repo", source);
  assert.deepEqual(result.errors, ["rendering/src/new.ts: missing unit coverage"]);
});

test("accepts narrow capability type-only modules and reports each measured module", () => {
  const result = checkNewFileCoverage({ "/repo/ui/src/view.svelte": coverage(), total: coverage(1) }, ["ui/src/view.svelte", "rendering/src/Types.ts"], "/repo", source);
  assert.deepEqual(result.errors, []);
  assert.match(formatNewFileCoverage(result), /ui\/src\/view.svelte.*100\.00%/);
  assert.doesNotMatch(formatNewFileCoverage(result), /Types.ts/);
});

 test("new workspace or extension source cannot silently fall outside the coverage instrumentation", () => {
  const result = checkNewFileCoverage({}, ["extension/src/new.ts", "future-package/src/new.ts"], "/repo", source);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((error) => error.endsWith("missing unit coverage")));
});

test("invalid or absent metric counters cannot silently pass the gate", () => {
  for (const counters of [undefined, { covered: "bad", total: 10 }, { covered: 11, total: 10 }, { covered: 1, total: -1 }]) {
    const report = coverage();
    report.branches = counters;
    assert.ok(checkNewFileCoverage({ "/repo/debug/src/new.ts": report }, ["debug/src/new.ts"], "/repo", source).errors.length > 0);
  }
});

test("CLI compares the whole branch against its supplied base and fails on an uncovered addition", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = mkdtempSync(join(tmpdir(), "new-file-coverage-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const commit = () => {
 git("add", "."); git("-c", "user.name=Coverage", "-c", "user.email=coverage@localhost", "commit", "-m", "fixture");
};
  try {
    git("init", "-q");
    writeFileSync(join(root, "README.md"), "fixture");
    commit();
    git("tag", "base");
    mkdirSync(join(root, "rendering/src"), { recursive: true });
    writeFileSync(join(root, "rendering/src/new.ts"), "export function value() { return 1; }");
    commit();
    writeFileSync(join(root, "README.md"), "later unrelated commit");
    commit();
    mkdirSync(join(root, "coverage"));
    const report = join(root, "coverage/coverage-summary.json");
    const script = fileURLToPath(new URL("./check-new-file-coverage.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [script, "base"], { cwd: root, encoding: "utf8" });
    writeFileSync(report, "{}");
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /new.ts: missing unit coverage/);
    writeFileSync(report, JSON.stringify({ [join(root, "rendering/src/new.ts")]: coverage() }));
    const passing = run();
    assert.equal(passing.status, 0, passing.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
