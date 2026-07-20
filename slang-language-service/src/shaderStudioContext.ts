const SHADER_STUDIO_LANGUAGE_SUFFIX = [
  "static float3 iResolution;",
  "static float4 iMouse;",
  "static float iTime;",
  "static float iTimeDelta;",
  "static float iFrameRate;",
  "static int iFrame;",
  "static float4 iChannelTime;",
  "static float4 iChannelLoaded;",
  "static float iSampleRate;",
  "static float4 iDate;",
  "static float3 iChannelResolution[4];",
  "static float3 iCameraPos;",
  "static float3 iCameraDir;",
].join("\n");

function blankCommentsAndStrings(source: string): string {
  const result = source.split("");
  let index = 0;

  const blank = (position: number): void => {
    if (result[position] !== "\n") {
      result[position] = " ";
    }
  };

  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") {
        blank(index++);
      }
      continue;
    }

    if (source[index] === "/" && source[index + 1] === "*") {
      blank(index++);
      blank(index++);
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          blank(index++);
          blank(index++);
          break;
        }
        blank(index++);
      }
      continue;
    }

    const quote = source[index];
    if (quote === '"' || quote === "'") {
      blank(index++);
      while (index < source.length) {
        if (source[index] === "\\") {
          blank(index++);
          if (index < source.length) {
            blank(index++);
          }
          continue;
        }
        const character = source[index];
        blank(index++);
        if (character === quote) {
          break;
        }
      }
      continue;
    }

    index++;
  }

  return result.join("");
}

function blankPreprocessorLines(source: string): string {
  const result = source.split("");
  let lineStart = 0;
  let continuingDirective: boolean = false;

  while (lineStart < source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/, "");
    const isDirective: boolean = continuingDirective || /^[\t ]*#/.test(line);

    if (isDirective) {
      for (let index = lineStart; index < lineEnd; index++) {
        result[index] = " ";
      }
    }

    continuingDirective = isDirective && /\\[\t ]*$/.test(line);
    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }

  return result.join("");
}

function isDeclarationContext(source: string, candidateStart: number): boolean {
  let parenthesisDepth = 0;
  let attributeDepth = 0;
  let segmentStart = 0;

  for (let index = 0; index < candidateStart; index++) {
    const character = source[index];
    if (character === "(") {
      parenthesisDepth++;
    } else if (character === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (character === "[") {
      attributeDepth++;
    } else if (character === "]") {
      attributeDepth = Math.max(0, attributeDepth - 1);
    } else if (
      parenthesisDepth === 0
      && attributeDepth === 0
      && (character === ";" || character === "{" || character === "}")
    ) {
      segmentStart = index + 1;
    }
  }

  if (parenthesisDepth !== 0 || attributeDepth !== 0) {
    return false;
  }

  const prefix = source.slice(segmentStart, candidateStart);
  return /^\s*(?:(?:\[[^\[\]]*\]\s*)|(?:(?:public|static|inline|extern)\s+))*$/.test(prefix);
}

export function isShaderStudioEntrySource(source: string): boolean {
  const lexicalSource = blankPreprocessorLines(blankCommentsAndStrings(source));
  const entryPattern = /\bfloat4\s+mainImage\s*\(/g;
  return [...lexicalSource.matchAll(entryPattern)].some(
    (match) => isDeclarationContext(lexicalSource, match.index),
  );
}

export function createShaderStudioAnalysisSource(source: string): string {
  if (!isShaderStudioEntrySource(source)) {
    return source;
  }
  return `${source}${source.endsWith("\n") ? "" : "\n"}${SHADER_STUDIO_LANGUAGE_SUFFIX}`;
}
