/**
 * Compiler output reaches the editor markers, the VS Code diagnostics and the
 * error panel unchanged, and two things in it are pure repetition:
 *
 * - Multi-pass compiles report a shared module's failure once per pass that
 *   imports it, so one error in common.slang arrives N times with only the
 *   pass prefix differing.
 * - Slang closes a failed compile with "import failed due to compilation
 *   error", "compilation ceased" and "abort compilation", which name no
 *   location and say nothing the real errors above them have not.
 *
 * Both are dropped here, at the one point every consumer reads from.
 */

/** glslang reports `ERROR: <shader>:<line>:` instead of a `-->` line. */
const GLSL_LOCATION = /ERROR:\s*\d+:\d+:/;
/** Slang's epilogue: true only of blocks that report no location of their own. */
const TERMINAL_NOISE = [
  /import failed due to compilation error/i,
  /compilation ceased/i,
  /^\s*abort compilation\b/im,
];

interface ErrorBlock {
  /** Block text as it appeared, pass prefix included. */
  text: string;
  /** Pass name carried by this block's heading, when it has one. */
  pass?: string;
  /** Dedupe key: identical keys are the same diagnostic seen from two passes. */
  key: string;
  /** Whether the compiler reported a file position for this block. */
  located: boolean;
}

/** One diagnostic, as VS Code splits them into separate entries. */
export interface CompilerErrorBlock {
  /** Block text as the compiler wrote it, pass prefix included. */
  text: string;
  /** Pass name carried by this block's heading, when it has one. */
  pass?: string;
  /** Where the compiler pointed, when it reported a position. */
  location?: { path: string; line: number; column?: number };
}

interface SlangLocation {
  path: string;
  line: number;
  column?: number;
}

/**
 * Splits compiler output into one entry per diagnostic, the same way the VS
 * Code diagnostics do, so a panel can show them as separate blocks instead of
 * one wall of text.
 */
export function splitCompilerErrorBlocks(errors: readonly string[] | undefined): CompilerErrorBlock[] {
  return (errors ?? [])
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .flatMap((entry) => parseErrorBlocks(entry).map(({ text, pass }) => {
      const location = slangLocation(text);
      return {
        text,
        ...(pass === undefined ? {} : { pass }),
        ...(location
          ? {
            location: {
              path: location.path,
              line: location.line,
              ...(location.column === undefined ? {} : { column: location.column }),
            },
          }
          : {}),
      };
    }));
}

/** glslang reports `ERROR: <shader>:<line>:` after the line has been mapped back. */
const GLSL_REPORTED_LINE = /ERROR:\s*\d+:(\d+):/;
/**
 * WGSL diagnostics are formatted `<pass>: WGSL L<line>:<column>` once mapped to
 * the authored source. Common, vertex and generated-code lines use other
 * prefixes or owners and never name a line of the pass being edited.
 */
function wgslReportedLines(entry: string): number[] {
  const reported: number[] = [];
  for (const line of entry.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1 || line.slice(0, separator).trim() === "Common") {
      continue;
    }
    const detail = line.slice(separator + 1).trimStart();
    if (!detail.startsWith("WGSL")) {
      continue;
    }
    let index = 4;
    while (detail[index] === " " || detail[index] === "\t") {
      index++;
    }
    if (detail[index++] !== "L") {
      continue;
    }
    const lineStart = index;
    while (detail[index] >= "0" && detail[index] <= "9") {
      index++;
    }
    if (index > lineStart && detail[index] === ":") {
      reported.push(Number.parseInt(detail.slice(lineStart, index), 10));
    }
  }
  return reported;
}

/**
 * The first source line the compiler complained about, or null when it named
 * none. Everything below it failed to parse, so nothing there can be inspected.
 */
export function firstReportedErrorLine(errors: readonly string[] | undefined): number | null {
  let earliest: number | null = null;
  for (const entry of errors ?? []) {
    for (const line of typeof entry === "string" ? wgslReportedLines(entry) : []) {
      earliest = earliest === null ? line : Math.min(earliest, line);
    }
  }
  for (const block of splitCompilerErrorBlocks(errors)) {
    const glsl = block.text.match(GLSL_REPORTED_LINE);
    const line = block.location?.line ?? (glsl ? Number.parseInt(glsl[1], 10) : undefined);
    if (line !== undefined && Number.isFinite(line) && (earliest === null || line < earliest)) {
      earliest = line;
    }
  }
  return earliest;
}

export function dedupeCompilerErrors(errors: readonly string[] | undefined): string[] {
  if (!errors) {
    return [];
  }

  const seen = new Set<string>();
  const entries = errors
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => {
      const blocks = parseErrorBlocks(entry);
      return {
        entry,
        blockCount: blocks.length,
        // The pass prefix rides on the entry's first block, dropped or not.
        pass: blocks.find((block) => block.pass)?.pass,
        unseen: blocks.filter((block) => !seenBefore(seen, block)),
      };
    });

  // Slang's epilogue only earns its place when nothing located survived: a
  // compile that failed with the epilogue alone still has to say so.
  const dropNoise = entries.some(({ unseen }) => unseen.some((block) => block.located));

  const kept: string[] = [];
  for (const { entry, blockCount, pass, unseen } of entries) {
    const survivors = dropNoise ? unseen.filter((block) => !isTerminalNoise(block)) : unseen;
    if (survivors.length === 0) {
      continue;
    }
    if (survivors.length === blockCount) {
      kept.push(entry);
      continue;
    }
    // The dropped blocks may have included the one carrying the pass prefix,
    // which is how consumers attribute unlocated errors to a file.
    kept.push(restorePassPrefix(survivors, pass));
  }

  return kept;
}

function seenBefore(seen: Set<string>, block: ErrorBlock): boolean {
  if (seen.has(block.key)) {
    return true;
  }
  seen.add(block.key);
  return false;
}

/** A block with no position of its own that only restates that the compile failed. */
function isTerminalNoise(block: ErrorBlock): boolean {
  return !block.located && TERMINAL_NOISE.some((pattern) => pattern.test(block.text));
}

function restorePassPrefix(survivors: ErrorBlock[], entryPass: string | undefined): string {
  const [first, ...rest] = survivors;
  const text = entryPass && !first.pass ? `${entryPass}: ${first.text}` : first.text;
  return [text, ...rest.map((block) => block.text)].join("\n");
}

/**
 * Browser-compiler WGSL errors, already mapped onto user lines by the pass
 * pipelines (`<pass>: WGSL [internal: ]L<line>:<col> <message>`).
 */
function parseErrorBlocks(entry: string): ErrorBlock[] {
  const headings = errorHeadings(entry);
  if (headings.length === 0) {
    const text = entry.trim();
    const wgsl = parseWgslReported(text);
    if (wgsl) {
      // The pass prefix rides on every entry; the same user error from two
      // passes is one diagnostic.
      return [{
        text,
        key: `wgsl|${wgsl.line}:${wgsl.column}|${normalize(wgsl.message)}`,
        located: true,
      }];
    }
    return [{ text, key: `raw|${normalize(text)}`, located: false }];
  }

  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? entry.length;
    const text = entry.slice(heading.index, end).trimEnd();
    const { pass } = heading;
    return {
      text,
      pass,
      key: blockKey(text, pass),
      located: slangLocation(text) !== null || GLSL_LOCATION.test(text),
    };
  });
}

interface ErrorHeading {
  index: number;
  pass?: string;
}

function errorHeadings(entry: string): ErrorHeading[] {
  const headings: ErrorHeading[] = [];
  let lineStart = 0;
  while (lineStart < entry.length) {
    const newline = entry.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? entry.length : newline;
    const line = entry.slice(lineStart, lineEnd);
    const directMarker = errorMarkerEnd(line, 0);
    if (directMarker !== -1) {
      headings.push({ index: lineStart });
    } else {
      const separator = line.indexOf(":");
      if (separator > 0) {
        let markerStart = separator + 1;
        while (line[markerStart] === " " || line[markerStart] === "\t") {
          markerStart++;
        }
        if (errorMarkerEnd(line, markerStart) !== -1) {
          headings.push({ index: lineStart, pass: line.slice(0, separator).trim() });
        }
      }
    }
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }
  return headings;
}

function errorMarkerEnd(line: string, start: number): number {
  const lower = line.slice(start).toLowerCase();
  if (lower.startsWith("error:")) {
    return start + "error:".length;
  }
  if (!lower.startsWith("error[")) {
    return -1;
  }
  const close = line.indexOf("]", start + "error[".length);
  return close !== -1 && line[close + 1] === ":" ? close + 2 : -1;
}

function parseWgslReported(text: string): { line: number; column: number; message: string } | null {
  const separator = text.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  let detail = text.slice(separator + 1).trimStart();
  if (!detail.startsWith("WGSL ")) {
    return null;
  }
  detail = detail.slice(5);
  if (detail.startsWith("internal: ")) {
    detail = detail.slice("internal: ".length);
  }
  if (detail[0] !== "L") {
    return null;
  }
  const lineEnd = detail.indexOf(":", 1);
  if (lineEnd === -1) {
    return null;
  }
  const columnEnd = detail.indexOf(" ", lineEnd + 1);
  const line = Number.parseInt(detail.slice(1, lineEnd), 10);
  const column = Number.parseInt(detail.slice(lineEnd + 1, columnEnd), 10);
  return columnEnd !== -1 && Number.isFinite(line) && Number.isFinite(column)
    ? { line, column, message: detail.slice(columnEnd + 1) }
    : null;
}

/**
 * Slang names an absolute source path per block, so the same file/line/column
 * from two passes is one diagnostic. Everything else stays keyed by its pass:
 * two passes reporting "entry point not found" are two real failures.
 */
function blockKey(text: string, pass: string | undefined): string {
  const withoutPass = pass ? text.replace(`${pass}:`, "").trimStart() : text;
  const location = slangLocation(text);
  if (location) {
    return `located|${location.path}:${location.line}:${location.column ?? ""}|${normalize(withoutPass)}`;
  }
  return `pass|${pass ?? ""}|${normalize(withoutPass)}`;
}

function slangLocation(text: string): SlangLocation | null {
  for (const sourceLine of text.split("\n")) {
    const line = sourceLine.trim();
    if (!line.startsWith("-->")) {
      continue;
    }
    const location = line.slice(3).trim();
    const lastColon = location.lastIndexOf(":");
    if (lastColon === -1) {
      continue;
    }
    const lastNumber = Number.parseInt(location.slice(lastColon + 1), 10);
    if (!Number.isFinite(lastNumber)) {
      continue;
    }
    const beforeLast = location.slice(0, lastColon);
    const previousColon = beforeLast.lastIndexOf(":");
    if (previousColon !== -1) {
      const maybeLine = Number.parseInt(beforeLast.slice(previousColon + 1), 10);
      if (Number.isFinite(maybeLine)) {
        return { path: beforeLast.slice(0, previousColon), line: maybeLine, column: lastNumber };
      }
    }
    return { path: beforeLast, line: lastNumber };
  }
  return null;
}

function normalize(text: string): string {
  return text.split("\n").map((line) => line.trimEnd()).join("\n").trim();
}
