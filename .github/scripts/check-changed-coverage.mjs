import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRuntimeSource, NEW_FILE_THRESHOLDS } from './check-new-file-coverage.mjs';
export function changedLines(diff) {
  const lines = new Set();
  let line;
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
    } else if (line !== undefined && text.startsWith('+')) {
      lines.add(line++);
    } else if (line !== undefined && text.startsWith(' ')) {
      line++;
    }
  }
  return lines;
}
const hitsValid = (hits) => Number.isInteger(hits) && hits >= 0;
const touches = (location, lines) => location?.start && location?.end
  && [...lines].some((line) => line >= location.start.line && line <= location.end.line);
export function checkChangedCoverage(report, changes, root, readSource) {
  const normalized = new Map(Object.entries(report).map(([file, coverage]) => [relative(root, file).replaceAll('\\', '/'), coverage]));
  const errors = [];
  const files = [];
  for (const [file, lines] of changes) {
    if (!lines.size || !isRuntimeSource(file, readSource(file))) {
      continue;
    }
    const coverage = normalized.get(file);
    if (!coverage?.statementMap || !coverage?.s || !coverage?.branchMap || !coverage?.b || !coverage?.fnMap || !coverage?.f) {
      errors.push(`${file}: missing unit coverage maps`);
      files.push({ file, percentages: null });
      continue;
    }
    const counters = { statements: [], branches: [], functions: [], lines: [] };
    const lineHits = new Map();
    for (const [id, location] of Object.entries(coverage.statementMap)) {
      if (!touches(location, lines)) {
        continue;
      }
      counters.statements.push(coverage.s[id]);
      for (const line of lines) {
        if (line >= location.start.line && line <= location.end.line) {
          // A covered neighbour must not conceal another uncovered statement.
          lineHits.set(line, [...(lineHits.get(line) ?? []), coverage.s[id]]);
        }
      }
    }
    counters.lines = [...lineHits.values()].map((hits) => hits.every(hitsValid) ? Number(hits.every((hit) => hit > 0)) : NaN);
    for (const [id, branch] of Object.entries(coverage.branchMap)) {
      if (!touches(branch.loc, lines) && !branch.locations?.some((loc) => touches(loc, lines))) {
        continue;
      }
      const hits = coverage.b[id];
      if (!Array.isArray(hits) || !branch.locations?.length || hits.length !== branch.locations.length) {
        counters.branches.push(NaN);
      } else {
        counters.branches.push(...hits);
      }
    }
    for (const [id, fn] of Object.entries(coverage.fnMap)) {
      if (touches(fn.loc, lines)) {
        counters.functions.push(coverage.f[id]);
      }
    }
    const percentages = {};
    for (const [metric, threshold] of Object.entries(NEW_FILE_THRESHOLDS)) {
      const hits = counters[metric];
      if (!hits.every(hitsValid)) {
        errors.push(`${file}: invalid changed ${metric} coverage counters`);
      }
      percentages[metric] = hits.length ? 100 * hits.filter((hit) => hitsValid(hit) && hit > 0).length / hits.length : 100;
      if (percentages[metric] < threshold) {
        errors.push(`${file}: changed ${metric} ${percentages[metric].toFixed(2)}% < ${threshold}%`);
      }
    }
    files.push({ file, percentages });
  }
  return { files, errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) {
    throw new Error('Usage: node .github/scripts/check-changed-coverage.mjs BASE_REF');
  }
  const root = realpathSync(process.cwd());
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const comparison = `${base}...HEAD`;
  const files = git('diff', '--no-renames', '--name-only', '--diff-filter=M', '-z', comparison).split('\0').filter(Boolean);
  const changes = new Map(files.map((file) => [file, changedLines(git('diff', '--no-ext-diff', '--no-color', '--no-renames', '--unified=0', comparison, '--', file))]));
  const raw = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'));
  const report = Object.fromEntries(Object.entries(raw).map(([file, coverage]) => {
    try {
      return [realpathSync(file), coverage];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return [file, coverage];
    }
  }));
  const result = checkChangedCoverage(report, changes, root, (file) => readFileSync(resolve(root, file), 'utf8'));
  const table = ['| Changed source file | Statements | Branches | Functions | Lines |', '| --- | ---: | ---: | ---: | ---: |',
    ...result.files.map(({ file, percentages }) => `| ${file} | ${Object.keys(NEW_FILE_THRESHOLDS).map((metric) => percentages ? `${percentages[metric].toFixed(2)}%` : 'Missing').join(' | ')} |`)].join('\n') + '\n';
  process.stdout.write(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Changed-source unit coverage\n\n${table}`);
  }
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  }
}
