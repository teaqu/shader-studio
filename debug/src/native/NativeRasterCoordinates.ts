import { tokenizeShaderSource } from "@shader-studio/types";

type Language = "wgsl" | "slang";

/** Supply ShaderToy-space coordinates to existing debug controls without changing native inputs. */
export function nativeRasterCoordinates(source: string, header: string, language: Language, prefix: string, entryName: string): { header: string; setup: string; name: string } {
  const position = findPosition(source, header, language);
  const positionName = position ?? `${prefix}_position`;
  const coordinate = `${prefix}_coordinate`;
  const expression = language === "wgsl"
    ? `vec2f(${positionName}.x, iResolution.y - ${positionName}.y)`
    : `float2(${positionName}.x, iResolution.y - ${positionName}.y)`;
  return {
    header: position ? header : addPositionParameter(header, language, positionName, entryName),
    setup: language === "wgsl" ? `let ${coordinate} = ${expression};` : `float2 ${coordinate} = ${expression};`,
    name: coordinate,
  };
}

function tokenText(source: string): string {
  return tokenizeShaderSource(source).map(token => token.text).join(" ");
}

function positionField(text: string, language: Language): string | undefined {
  return language === "wgsl"
    ? /@\s*builtin\s*\(\s*position\s*\)\s*(?:@\s*[A-Za-z_]\w*\s*(?:\([^)]*\)\s*)?)*([A-Za-z_]\w*)\s*:/.exec(text)?.[1]
    : /([A-Za-z_]\w*)\s*:\s*SV_Position\b/.exec(text)?.[1];
}

function findPosition(source: string, header: string, language: Language): string | undefined {
  const text = tokenText(header);
  const direct = positionField(text, language);
  if (direct) {
    return direct;
  }
  const structs = tokenText(source).matchAll(/\bstruct\s+([A-Za-z_]\w*)\s*\{([^}]+)\}/g);
  for (const struct of structs) {
    const field = positionField(struct[2]!, language);
    if (!field) {
      continue;
    }
    const type = struct[1]!;
    const parameter = language === "wgsl"
      ? new RegExp(`([A-Za-z_]\\w*)\\s*:\\s*${type}\\b`).exec(text)?.[1]
      : new RegExp(`\\b${type}\\s+([A-Za-z_]\\w*)`).exec(text)?.[1];
    if (parameter) {
      return `${parameter}.${field}`;
    }
  }
  return undefined;
}

function addPositionParameter(header: string, language: Language, position: string, entryName: string): string {
  const tokens = tokenizeShaderSource(header);
  const opening = tokens.findIndex((token, index) => token.text === "(" && tokens[index - 1]?.text === entryName);
  let depth = 0;
  for (let index = opening; index < tokens.length; index++) {
    if (tokens[index]!.text === "(") {
      depth++;
    }
    if (tokens[index]!.text !== ")" || --depth !== 0) {
      continue;
    }
    const offset = tokens[index]!.start;
    const previous = tokens[index - 1]?.text;
    const separator = previous === "(" ? "" : previous === "," ? " " : ", ";
    const parameter = language === "wgsl" ? `@builtin(position) ${position}: vec4f` : `float4 ${position} : SV_Position`;
    return `${header.slice(0, offset)}${separator}${parameter}${header.slice(offset)}`;
  }
  return header;
}
