import type { Range } from "vscode-languageserver-protocol";
import type { ParserFailure, ParserLocation } from "./GlslParserAst.js";
import { IDENTIFIER } from "./GlslParserAst.js";
import type {
  GlslParseDiagnostic
} from "./model.js";
import { mapProcessedLine } from "./sourceMap.js";

export function createDiagnostic(
  code: GlslParseDiagnostic["code"],
  error: unknown,
  originalLines: readonly string[],
  processedLines: readonly string[] = originalLines,
  processedToOriginal?: readonly number[],
): GlslParseDiagnostic {
  const failure = error instanceof Error ? error as ParserFailure : undefined;
  const rawRange = failure?.location;
  const range = rawRange
    ? code === "syntax"
      ? mapDiagnosticLocation(rawRange, originalLines, processedLines, processedToOriginal)
      : mapLocation(rawRange, originalLines, originalLines, processedToOriginal)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const adjustedRange = code === "syntax" && rawRange && parserLocationIsEmpty(rawRange)
    ? moveEofRangeToCode(range, originalLines)
    : range;
  return {
    code,
    message: failure?.message ?? String(error),
    range: adjustedRange,
    severity: 1,
  };
}

function mapDiagnosticLocation(
  location: ParserLocation,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal?: readonly number[],
): Range {
  const range = mapLocation(location, originalLines, processedLines, processedToOriginal);
  const processedLineIndex = Math.max(0, location.start.line - 1);
  if (
    location.start.line !== location.end.line
    || range.start.line !== range.end.line
    || parserLocationIsEmpty(location)
  ) {
    return range;
  }

  const original = originalLines[range.start.line] ?? "";
  const processed = processedLines[processedLineIndex] ?? "";
  const processedStart = Math.max(0, location.start.column - 1);
  const length = Math.max(1, location.end.column - location.start.column);
  const characterMaps = new Map<string, readonly number[]>();
  const characterMap = buildCharacterMap(original, processed);
  characterMaps.set(`${range.start.line}:${processedLineIndex}`, characterMap);
  const originalStart = mapProcessedSpanToOriginal(
    original,
    processed,
    processedStart,
    length,
    characterMap,
  );
  if (originalStart !== undefined) {
    return {
      start: { line: range.start.line, character: originalStart },
      end: { line: range.start.line, character: originalStart + length },
    };
  }
  return mapGeneratedLocation(
    location,
    originalLines,
    processedLines,
    processedToOriginal ?? processedLines.map((_, index) => index),
    characterMaps,
  );
}

function parserLocationIsEmpty(location: ParserLocation): boolean {
  return location.start.offset === location.end.offset;
}

function moveEofRangeToCode(range: Range, lines: readonly string[]): Range {
  let line = range.start.line;
  while (line > 0 && (lines[line] ?? "").trim() === "") {
    line--;
  }
  const character = lines[line]?.length ?? 0;
  return {
    start: { line, character },
    end: { line, character },
  };
}

export function mapIdentifierLocation(
  location: ParserLocation,
  name: string,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[],
  characterMaps: Map<string, readonly number[]>,
): Range | undefined {
  const range = mapLocation(location, originalLines, processedLines, processedToOriginal);
  if (range.start.line !== range.end.line || !IDENTIFIER.test(name)) {
    return range;
  }
  const line = originalLines[range.start.line] ?? "";
  const matches = [...line.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))];
  if (matches.length === 0) {
    return undefined;
  }
  const processedLine = processedLines[Math.max(0, location.start.line - 1)] ?? "";
  const processedCharacter = Math.max(0, location.start.column - 1);
  const characterMapKey = `${range.start.line}:${Math.max(0, location.start.line - 1)}`;
  let characterMap = characterMaps.get(characterMapKey);
  if (!characterMap) {
    characterMap = buildCharacterMap(line, processedLine);
    characterMaps.set(characterMapKey, characterMap);
  }
  const alignedCharacter = mapProcessedSpanToOriginal(
    line,
    processedLine,
    processedCharacter,
    name.length,
    characterMap,
  );
  if (alignedCharacter !== undefined && line.slice(alignedCharacter, alignedCharacter + name.length) === name) {
    return {
      start: { line: range.start.line, character: alignedCharacter },
      end: { line: range.start.line, character: alignedCharacter + name.length },
    };
  }
  const processedMatches = [...processedLine.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))];
  const processedOccurrence = processedMatches.findIndex((match) => (
    (match.index ?? -1) <= processedCharacter
    && processedCharacter < (match.index ?? -1) + name.length
  ));
  if (processedOccurrence >= 0 && processedMatches.length === matches.length) {
    const character = matches[processedOccurrence].index ?? range.start.character;
    return {
      start: { line: range.start.line, character },
      end: { line: range.start.line, character: character + name.length },
    };
  }
  return undefined;
}

function mapProcessedSpanToOriginal(
  original: string,
  processed: string,
  processedStart: number,
  length: number,
  characterMap: readonly number[],
): number | undefined {
  if (processedStart + length > processed.length || original.length === 0) {
    return undefined;
  }
  const originalStart = characterMap[processedStart];
  if (originalStart === undefined || originalStart < 0) {
    return undefined;
  }
  for (let offset = 1; offset < length; offset++) {
    if (characterMap[processedStart + offset] !== originalStart + offset) {
      return undefined;
    }
  }
  return originalStart;
}

export function mapGeneratedLocation(
  location: ParserLocation,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[],
  characterMaps: Map<string, readonly number[]>,
): Range {
  const range = mapLocation(location, originalLines, processedLines, processedToOriginal);
  if (range.start.line !== range.end.line) {
    return range;
  }
  const processedLineIndex = Math.max(0, location.start.line - 1);
  const original = originalLines[range.start.line] ?? "";
  const processed = processedLines[processedLineIndex] ?? "";
  const characterMapKey = `${range.start.line}:${processedLineIndex}`;
  let characterMap = characterMaps.get(characterMapKey);
  if (!characterMap) {
    characterMap = buildCharacterMap(original, processed);
    characterMaps.set(characterMapKey, characterMap);
  }

  const processedStart = Math.max(0, location.start.column - 1);
  const processedEnd = Math.max(processedStart, location.end.column - 1);
  let originalStart = 0;
  for (let index = processedStart - 1; index >= 0; index--) {
    const mapped = characterMap[index];
    if (mapped !== undefined && mapped >= 0) {
      originalStart = mapped + 1;
      break;
    }
  }
  let originalEnd = original.length;
  for (let index = processedEnd; index < characterMap.length; index++) {
    const mapped = characterMap[index];
    if (mapped !== undefined && mapped >= originalStart) {
      originalEnd = mapped;
      break;
    }
  }

  const replacement = original.slice(originalStart, originalEnd);
  const invocation = replacement.match(/[A-Za-z_]\w*/);
  if (invocation?.index !== undefined) {
    originalStart += invocation.index;
    originalEnd = originalStart + invocation[0].length;
  } else {
    const containingInvocation = findContainingInvocation(original, originalStart, originalEnd);
    if (containingInvocation) {
      originalStart = containingInvocation.start;
      originalEnd = containingInvocation.end;
    }
  }
  return {
    start: { line: range.start.line, character: originalStart },
    end: { line: range.start.line, character: Math.max(originalStart, originalEnd) },
  };
}

function findContainingInvocation(
  line: string,
  rangeStart: number,
  rangeEnd: number,
): { start: number; end: number } | undefined {
  const candidates: { start: number; end: number }[] = [];
  for (const match of line.matchAll(/\b[A-Za-z_]\w*\s*\(/g)) {
    const matchStart = match.index ?? -1;
    const open = matchStart + match[0].lastIndexOf("(");
    let depth = 0;
    let close = -1;
    for (let index = open; index < line.length; index++) {
      if (line[index] === "(") {
        depth++;
      }
      if (line[index] === ")") {
        depth--;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close >= 0 && rangeStart >= matchStart && rangeEnd <= close + 1) {
      const name = match[0].match(/[A-Za-z_]\w*/)?.[0];
      if (name) {
        candidates.push({ start: matchStart, end: matchStart + name.length });
      }
    }
  }
  return candidates[candidates.length - 1];
}

function buildCharacterMap(original: string, processed: string): number[] {
  const map = new Array(processed.length).fill(-1) as number[];
  let prefix = 0;
  while (prefix < original.length && prefix < processed.length && original[prefix] === processed[prefix]) {
    map[prefix] = prefix;
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < original.length - prefix
    && suffix < processed.length - prefix
    && original[original.length - suffix - 1] === processed[processed.length - suffix - 1]
  ) {
    map[processed.length - suffix - 1] = original.length - suffix - 1;
    suffix++;
  }

  const originalMiddle = original.slice(prefix, original.length - suffix);
  const processedMiddle = processed.slice(prefix, processed.length - suffix);
  const longestCommonSubsequence: number[][] = Array.from(
    { length: originalMiddle.length + 1 },
    () => new Array(processedMiddle.length + 1).fill(0) as number[],
  );
  for (let originalIndex = originalMiddle.length - 1; originalIndex >= 0; originalIndex--) {
    for (let processedIndex = processedMiddle.length - 1; processedIndex >= 0; processedIndex--) {
      longestCommonSubsequence[originalIndex][processedIndex] = originalMiddle[originalIndex] === processedMiddle[processedIndex]
        ? longestCommonSubsequence[originalIndex + 1][processedIndex + 1] + 1
        : Math.max(
          longestCommonSubsequence[originalIndex + 1][processedIndex],
          longestCommonSubsequence[originalIndex][processedIndex + 1],
        );
    }
  }

  let originalIndex = 0;
  let processedIndex = 0;
  while (originalIndex < originalMiddle.length && processedIndex < processedMiddle.length) {
    if (originalMiddle[originalIndex] === processedMiddle[processedIndex]) {
      map[prefix + processedIndex] = prefix + originalIndex;
      originalIndex++;
      processedIndex++;
    } else if (
      longestCommonSubsequence[originalIndex + 1][processedIndex]
      >= longestCommonSubsequence[originalIndex][processedIndex + 1]
    ) {
      originalIndex++;
    } else {
      processedIndex++;
    }
  }
  return map;
}

export function mapLocation(
  location: ParserLocation | undefined,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[] = processedLines.map((_, index) => index),
): Range {
  if (!location) {
    return sourceRange(originalLines);
  }
  const startProcessedLine = Math.max(0, location.start.line - 1);
  const endProcessedLine = Math.max(0, location.end.line - 1);
  const startLine = clampLine(
    mapProcessedLine(processedToOriginal, startProcessedLine),
    originalLines.length,
  );
  const endLine = clampLine(
    mapProcessedLine(processedToOriginal, endProcessedLine),
    originalLines.length,
  );
  return {
    start: {
      line: startLine,
      character: clampCharacter(location.start.column - 1, originalLines[startLine]),
    },
    end: {
      line: endLine,
      character: clampCharacter(location.end.column - 1, originalLines[endLine]),
    },
  };
}

export function sourceRange(lines: readonly string[]): Range {
  const endLine = Math.max(0, lines.length - 1);
  return {
    start: { line: 0, character: 0 },
    end: { line: endLine, character: lines[endLine]?.length ?? 0 },
  };
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, Math.max(0, lineCount - 1)));
}

function clampCharacter(character: number, line: string | undefined): number {
  return Math.max(0, Math.min(character, line?.length ?? 0));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
