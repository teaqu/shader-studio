export interface GlslLineMapping {
  readonly originalToProcessed: readonly number[];
  readonly processedToOriginal: readonly number[];
}

function normalizeLine(line: string): string {
  const commentIndex = line.indexOf("//");
  const uncommented = commentIndex >= 0 ? line.substring(0, commentIndex) : line;
  return uncommented.trim().replace(/\s+/g, " ");
}

export function buildGlslLineMapping(
  originalLines: readonly string[],
  processedLines: readonly string[],
): GlslLineMapping {
  if (originalLines.join("\n") === processedLines.join("\n")) {
    return {
      originalToProcessed: originalLines.map((_, index) => index),
      processedToOriginal: processedLines.map((_, index) => index),
    };
  }

  const originalNorm = originalLines.map(normalizeLine);
  const processedNorm = processedLines.map(normalizeLine);
  const longestCommonSubsequence: number[][] = Array.from(
    { length: originalNorm.length + 1 },
    () => new Array(processedNorm.length + 1).fill(0) as number[],
  );

  for (let original = originalNorm.length - 1; original >= 0; original--) {
    for (let processed = processedNorm.length - 1; processed >= 0; processed--) {
      longestCommonSubsequence[original][processed] = originalNorm[original] === processedNorm[processed]
        ? longestCommonSubsequence[original + 1][processed + 1] + 1
        : Math.max(
          longestCommonSubsequence[original + 1][processed],
          longestCommonSubsequence[original][processed + 1],
        );
    }
  }

  const originalToProcessed = new Array(originalNorm.length).fill(-1) as number[];
  const processedToOriginal = new Array(processedNorm.length).fill(-1) as number[];
  let original = 0;
  let processed = 0;

  while (original < originalNorm.length && processed < processedNorm.length) {
    if (originalNorm[original] === processedNorm[processed]) {
      originalToProcessed[original] = processed;
      processedToOriginal[processed] = original;
      original++;
      processed++;
    } else if (
      longestCommonSubsequence[original + 1][processed]
      >= longestCommonSubsequence[original][processed + 1]
    ) {
      original++;
    } else {
      processed++;
    }
  }

  const anchors = [
    { original: -1, processed: -1 },
    ...originalToProcessed
      .map((processedLine, originalLine) => ({ original: originalLine, processed: processedLine }))
      .filter((anchor) => anchor.processed !== -1),
    { original: originalNorm.length, processed: processedNorm.length },
  ];

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex++) {
    const current = anchors[anchorIndex];
    const next = anchors[anchorIndex + 1];
    const originalCandidates: number[] = [];
    const processedCandidates: number[] = [];

    for (let line = current.original + 1; line < next.original; line++) {
      if (
        originalToProcessed[line] === -1
        && originalNorm[line] !== ""
        && !originalNorm[line].startsWith("#")
      ) {
        originalCandidates.push(line);
      }
    }

    for (let line = current.processed + 1; line < next.processed; line++) {
      if (processedToOriginal[line] === -1 && processedNorm[line] !== "") {
        processedCandidates.push(line);
      }
    }

    if (originalCandidates.length !== processedCandidates.length) {
      continue;
    }

    for (let candidate = 0; candidate < originalCandidates.length; candidate++) {
      const originalLine = originalCandidates[candidate];
      const processedLine = processedCandidates[candidate];
      originalToProcessed[originalLine] = processedLine;
      processedToOriginal[processedLine] = originalLine;
    }
  }

  return { originalToProcessed, processedToOriginal };
}

export function mapProcessedLine(
  processedToOriginal: readonly number[],
  processedLine: number,
): number {
  if (processedLine < 0) {
    return -1;
  }
  if (processedLine < processedToOriginal.length && processedToOriginal[processedLine] !== -1) {
    return processedToOriginal[processedLine];
  }

  for (let line = Math.min(processedLine, processedToOriginal.length - 1); line >= 0; line--) {
    if (processedToOriginal[line] !== -1) {
      return processedToOriginal[line];
    }
  }

  return processedLine;
}

export function mapOriginalLine(
  originalToProcessed: readonly number[],
  originalLine: number,
  floorLine = 0,
): number {
  if (originalLine >= 0 && originalLine < originalToProcessed.length) {
    const direct = originalToProcessed[originalLine];
    if (direct !== -1) {
      return direct;
    }
  }

  for (let line = Math.min(originalLine, originalToProcessed.length - 1); line >= floorLine; line--) {
    if (originalToProcessed[line] !== -1) {
      return originalToProcessed[line];
    }
  }

  return Math.max(0, originalLine);
}
