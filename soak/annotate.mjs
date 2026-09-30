// Soak-branch only. Job logs and artifacts are not readable from the session
// that analyses these runs, but check-run annotations are, so this condenses a
// suite log into a few ::notice/::error annotations.
import { readFileSync } from 'node:fs';

const [, , logPath, label, rcArg, canaryPath] = process.argv;
process.on('uncaughtException', (error) => {
  console.log(`::error title=annotate crashed for ${label}::${String(error?.stack ?? error).replace(/\n/g, '%0A')}`);
  process.exit(0);
});
const rc = Number(rcArg ?? 0);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const lines = strip(readFileSync(logPath, 'utf8')).split('\n');
const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const emit = (level, title, body) => {
  // GitHub drops an annotation whose escaped message is too large; stay far below it.
  let text = esc(body);
  if (text.length > 30_000) text = `${text.slice(0, 30_000)}%0A…truncated`;
  console.log(`::${level} title=${esc(title).replace(/[,:]/g, ' ')}::${text}`);
};

// Readback trace: the vitest "stdout | file > suite > test" header names the
// fixture that produced the [soak] lines under it.
let current = '(unknown)';
const reads = [];
const timeouts = [];
for (const line of lines) {
  const header = line.match(/^stdout \| .*? > (.*)$/);
  if (header) {
    current = header[1].replace(/^slang-multipass-test shader corpus > /, '');
    continue;
  }
  const soak = line.match(/\[soak\] t=(\d+) (\w+) req=(\d+) readbackMs=([\d.]+) queueDrainMs=(-?[\d.]+) (.*)$/);
  if (soak) {
    const named = soak[6].match(/ test=(.*)$/);
    const test = named ? named[1].replace(/^slang-multipass-test shader corpus > /, '') : current;
    reads.push({ t: +soak[1], test, lang: soak[2], req: +soak[3], ms: +soak[4], drain: +soak[5], live: soak[6].replace(/ test=.*$/, '') });
    continue;
  }
  if (line.includes('[soak] TIMEOUT')) timeouts.push(`${current}: ${line.trim()}`);
}

const adapterLine = lines.find((l) => l.includes('[soak] adapter')) ?? 'adapter: not logged';
const out = [`exit=${rc} readbacks=${reads.length} soakTimeouts=${timeouts.length}`, adapterLine.trim()];
if (reads.length > 0) {
  const sorted = [...reads].map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1);
  out.push(`readbackMs p50=${q(0.5)} p95=${q(0.95)} p99=${q(0.99)} max=${q(1)}`);
  const firstSlow = reads.findIndex((r) => r.ms > 1000 || r.drain > 1000);
  if (firstSlow >= 0) {
    out.push('', `readbacks leading into the first >1s readback/drain (index ${firstSlow}):`);
    for (const r of reads.slice(Math.max(0, firstSlow - 25), firstSlow + 8)) {
      out.push(`${r.req} ${r.lang} ${r.ms.toFixed(0)}ms drain=${r.drain.toFixed(0)} ${r.test} | ${r.live}`);
    }
  }
  out.push('', 'slowest 25 readbacks:');
  for (const r of [...reads].sort((a, b) => b.ms - a.ms).slice(0, 25)) {
    out.push(`${r.req} ${r.lang} ${r.ms.toFixed(0)}ms drain=${r.drain.toFixed(0)} ${r.test}`);
  }
  // Per-fixture totals: where the GPU time goes across the whole run.
  const byTest = new Map();
  for (const r of reads) byTest.set(r.test, (byTest.get(r.test) ?? 0) + r.ms);
  out.push('', 'most expensive 15 fixtures (sum of readbackMs):');
  for (const [test, ms] of [...byTest].sort((a, b) => b[1] - a[1]).slice(0, 15)) out.push(`${ms.toFixed(0)}ms ${test}`);
}
if (timeouts.length > 0) out.push('', 'timeouts:', ...timeouts.slice(0, 20));

// A separate-process canary: did the host GPU stall at the same wall-clock time?
if (canaryPath) {
  let canary = [];
  try { canary = readFileSync(canaryPath, 'utf8').split('\n').filter(Boolean); } catch { /* no canary */ }
  const spikes = canary.map((l) => l.match(/^spike t=(\d+) ms=(\d+)/)).filter(Boolean).map((m) => ({ t: +m[1], ms: +m[2] }));
  const first = reads[0]?.t ?? 0; const last = reads.at(-1)?.t ?? Infinity;
  const inRun = spikes.filter((s) => s.t >= first - 5000 && s.t <= last + 30000);
  out.push('', `canary spikes (>100ms trivial submit, separate process) during this run: ${inRun.length}`);
  for (const s of inRun.slice(0, 40)) out.push(`canary t=${s.t} (+${((s.t - first) / 1000).toFixed(1)}s) ${s.ms}ms`);
  const slow = reads.filter((r) => r.ms > 1000);
  if (slow.length > 0) {
    const overlapped = slow.filter((r) => inRun.some((s) => s.t >= r.t - r.ms - 1000 && s.t <= r.t + 1000)).length;
    out.push(`slow readbacks (>1s) overlapping a canary spike: ${overlapped}/${slow.length}`);
  }
  const windows = canary.filter((l) => l.startsWith('window')).slice(-3);
  out.push(...windows);
}

// Failures, generic across vitest, mocha and playwright output.
const failure = /(FAIL |✗|✘|×| failing|^\s+\d+\) |AssertionError|Error:|Timed out|did not request|did not encode|Unexpected end of JSON)/;
const failed = [];
const seen = new Set();
for (let i = 0; i < lines.length; i += 1) {
  if (failure.test(lines[i]) && !seen.has(lines[i].trim())) {
    seen.add(lines[i].trim());
    failed.push(...lines.slice(i, i + (/ failing/.test(lines[i]) ? 60 : 3)).map((l) => l.trimEnd()));
  }
  if (failed.length > 400) break;
}
const tail = lines.filter((l) => /Test Files|Tests\s+\d|^\s*\d+ (passing|failing|pending)|\d+ passed|\d+ failed|\d+ flaky/.test(l)).slice(-8);
out.push('', 'result lines:', ...tail);

emit('notice', `${label}`, out.join('\n'));
if (rc !== 0) {
  // Several short error annotations survive where one long one is dropped.
  const chunks = [];
  for (let i = 0; i < failed.length && chunks.length < 1; i += 90) chunks.push(failed.slice(i, i + 90).join('\n'));
  if (chunks.length === 0) chunks.push(lines.slice(-60).join('\n'));
  chunks.forEach((chunk, index) => emit('error', `${label} failures ${index + 1}/${chunks.length}`, chunk));
}
