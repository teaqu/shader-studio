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

const HEADING = /(?:^|\n)(?:([^:\n]+):[ \t]*)?(?:ERROR:|error(?:\[[^\]]+\])?:)/gi;
const SLANG_LOCATION = /^\s*-->\s+(.+?):(\d+)(?::(\d+))?\s*$/m;
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

/**
 * Splits compiler output into one entry per diagnostic, the same way the VS
 * Code diagnostics do, so a panel can show them as separate blocks instead of
 * one wall of text.
 */
export function splitCompilerErrorBlocks(errors: readonly string[] | undefined): CompilerErrorBlock[] {
  return (errors ?? [])
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .flatMap((entry) => parseErrorBlocks(entry).map(({ text, pass }) => {
      const location = text.match(SLANG_LOCATION);
      return {
        text,
        ...(pass === undefined ? {} : { pass }),
        ...(location
          ? {
            location: {
              path: location[1],
              line: Number.parseInt(location[2], 10),
              ...(location[3] === undefined ? {} : { column: Number.parseInt(location[3], 10) }),
            },
          }
          : {}),
      };
    }));
}

/** glslang reports `ERROR: <shader>:<line>:` after the line has been mapped back. */
const GLSL_REPORTED_LINE = /ERROR:\s*\d+:(\d+):/;

/**
 * The first source line the compiler complained about, or null when it named
 * none. Everything below it failed to parse, so nothing there can be inspected.
 */
export function firstReportedErrorLine(errors: readonly string[] | undefined): number | null {
  let earliest: number | null = null;
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

function parseErrorBlocks(entry: string): ErrorBlock[] {
  const headings = [...entry.matchAll(HEADING)];
  if (headings.length === 0) {
    const text = entry.trim();
    return [{ text, key: `raw|${normalize(text)}`, located: false }];
  }

  return headings.map((heading, index) => {
    // The match starts at the preceding newline for every heading but the first.
    const start = (heading.index ?? 0) + (heading[0].startsWith("\n") ? 1 : 0);
    const end = headings[index + 1]?.index ?? entry.length;
    const text = entry.slice(start, end).trimEnd();
    const pass = heading[1]?.trim();
    return {
      text,
      pass,
      key: blockKey(text, pass),
      located: SLANG_LOCATION.test(text) || GLSL_LOCATION.test(text),
    };
  });
}

/**
 * Slang names an absolute source path per block, so the same file/line/column
 * from two passes is one diagnostic. Everything else stays keyed by its pass:
 * two passes reporting "entry point not found" are two real failures.
 */
function blockKey(text: string, pass: string | undefined): string {
  const withoutPass = pass ? text.replace(`${pass}:`, "").trimStart() : text;
  const location = text.match(SLANG_LOCATION);
  if (location) {
    return `located|${location[1]}:${location[2]}:${location[3] ?? ""}|${normalize(withoutPass)}`;
  }
  return `pass|${pass ?? ""}|${normalize(withoutPass)}`;
}

function normalize(text: string): string {
  return text.split("\n").map((line) => line.trimEnd()).join("\n").trim();
}
