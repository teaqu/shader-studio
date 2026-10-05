import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const NEW_FILE_THRESHOLDS = { statements: 90, branches: 80, functions: 85, lines: 90 };
const SOURCE = /^(?:[^/]+|language-servers\/[^/]+)\/src\/.*\.(?:ts|svelte)$/;

/** Declarations and type-only boundaries have no executable unit contract. */
export function isRuntimeSource(file, source) {
  if (!SOURCE.test(file) || /(?:^|\/)(?:test|tests|__tests__|generated)(?:\/|$)/.test(file)
    || /\.(?:test|spec|bench|generated)\./.test(file) || file.endsWith(".d.ts") || file.startsWith("ui/src/slang/")) {
    return false;
  }
  if (file.endsWith(".svelte")) {
    return true;
  }
  const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, removeComments: true } }).outputText;
  // Re-export barrels forward contracts to instrumented definitions. Istanbul
  // emits no counters for them, even when a unit test imports their exports.
  const ast = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true);
  return ast.statements.some(statement => !ts.isExportDeclaration(statement));
}

export function checkNewFileCoverage(report, addedFiles, root, readSource) {
  const normalized = new Map(Object.entries(report).filter(([file]) => file !== "total")
    .map(([file, coverage]) => [relative(root, file).replaceAll("\\", "/"), coverage]));
  const errors = [];
  const files = [];
  for (const file of [...new Set(addedFiles)].sort()) {
    if (!SOURCE.test(file) || !isRuntimeSource(file, readSource(file))) {
      continue;
    }
    const coverage = normalized.get(file);
    if (!coverage?.statements?.total || !coverage?.lines?.total) {
      errors.push(`${file}: missing unit coverage`);
      files.push({ file, percentages: null });
      continue;
    }
    const percentages = {};
    for (const [metric, threshold] of Object.entries(NEW_FILE_THRESHOLDS)) {
      const counters = coverage[metric];
      const valid = counters && Number.isFinite(counters.total) && Number.isFinite(counters.covered)
        && counters.total >= 0 && counters.covered >= 0 && counters.covered <= counters.total;
      if (!valid) {
        errors.push(`${file}: invalid unit coverage counters for ${metric}`);
      }
      const percentage = valid ? counters.total === 0 ? 100 : 100 * counters.covered / counters.total : 0;
      percentages[metric] = percentage;
      if (percentage < threshold) {
        errors.push(`${file}: ${metric} ${percentage.toFixed(2)}% < ${threshold}%`);
      }
    }
    files.push({ file, percentages });
  }
  return { files, errors };
}

export function formatNewFileCoverage({ files }) {
  const rows = ["| New source file | Statements | Branches | Functions | Lines |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const { file, percentages } of files) {
    rows.push(`| ${file} | ${Object.keys(NEW_FILE_THRESHOLDS).map((metric) => percentages ? `${percentages[metric].toFixed(2)}%` : "Missing").join(" | ")} |`);
  }
  return `${rows.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // CI checks out a merge commit for PRs: its first parent is the exact base.
  // Local runs use an explicit base to cover the whole PR rather than one commit.
  const base = process.argv[2];
  if (!base) {
    throw new Error("Usage: node .github/scripts/check-new-file-coverage.mjs BASE_REF");
  }
  const root = process.cwd();
  const added = execFileSync("git", ["diff", "--name-only", "--diff-filter=AR", "-z", `${base}...HEAD`], { encoding: "utf8" }).split("\0").filter(Boolean);
  const rawReport = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
  // macOS /tmp and /var aliases can differ between the report and cwd.
  // Keep unknown entries intact so missing coverage still fails closed.
  const report = Object.fromEntries(Object.entries(rawReport).map(([file, counters]) => {
    if (file === "total") {
      return [file, counters];
    }
    try {
      return [realpathSync(file), counters];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      return [file, counters];
    }
  }));
  const result = checkNewFileCoverage(report, added, root, (file) => readFileSync(resolve(root, file), "utf8"));
  const table = formatNewFileCoverage(result);
  process.stdout.write(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## New-file unit coverage\n\n${table}`);
  }
  if (result.errors.length) {
    console.error(`New-file unit coverage failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  }
}
