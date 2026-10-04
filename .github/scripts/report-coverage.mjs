import { appendFileSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

const METRICS = ["statements", "branches", "functions", "lines"];
const PACKAGES = ["debug", "rendering", "ui", "language-servers/core", "language-servers/glsl-analysis", "language-servers/glsl", "language-servers/slang", "language-servers/wgsl-analysis", "language-servers/wgsl", "types", "utils", "monaco", "standalone", "shader-explorer"];

export function summarizeCoverage(report, root) {
  const summary = Object.fromEntries(PACKAGES.map((name) => [name,
    Object.fromEntries(METRICS.map((metric) => [metric, { covered: 0, total: 0 }]))]));
  for (const [file, coverage] of Object.entries(report)) {
    const normalized = relative(root, file).replaceAll("\\", "/");
    const name = PACKAGES.find((candidate) => normalized.startsWith(`${candidate}/src/`));
    if (!name) {
      continue;
    }
    for (const metric of METRICS) {
      summary[name][metric].covered += coverage[metric].covered;
      summary[name][metric].total += coverage[metric].total;
    }
  }
  return summary;
}

export function formatCoverage(summary) {
  const rows = ["| Package | Statements | Branches | Functions | Lines |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const name of PACKAGES) {
    const metrics = METRICS.map((metric) => {
      const { covered, total } = summary[name][metric];
      return total ? `${(100 * covered / total).toFixed(2)}%` : "No data";
    });
    rows.push(`| ${name} | ${metrics.join(" | ")} |`);
  }
  return `${rows.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const report = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
  const table = formatCoverage(summarizeCoverage(report, process.cwd()));
  process.stdout.write(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Unit coverage\n\n${table}`);
  }
}
