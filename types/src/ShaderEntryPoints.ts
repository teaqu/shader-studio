import type { ShaderConfig } from "./ShaderConfig";
import type { ShaderLanguageId } from "./shader-environment/ShaderLanguages";

export type NativeShaderStage = "vertex" | "fragment" | "compute";
export interface ShaderEntryPoint { name: string; stage: NativeShaderStage; }
export interface ShaderSourceFunction {
  name: string;
  stage?: NativeShaderStage;
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}

export interface ShaderSourceToken {
  text: string;
  kind: "identifier" | "string" | "punctuation";
  start: number;
  end: number;
}

/** Small source lexer shared by discovery and stage isolation, not a shader validator. */
export function tokenizeShaderSource(source: string): ShaderSourceToken[] {
  const tokens: ShaderSourceToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index++; continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth++; index += 2;
        } else if (source.startsWith("*/", index)) {
          depth--; index += 2;
        } else {
          index++;
        }
      }
      continue;
    }
    const start = index++;
    let kind: ShaderSourceToken["kind"] = "punctuation";
    if (character === '"' || character === "'") {
      kind = "string";
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index++] === character) {
          break;
        }
      }
    } else if (/[A-Za-z_]/.test(character)) {
      kind = "identifier";
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index]!)) {
        index++;
      }
    }
    tokens.push({ text: source.slice(start, index), kind, start, end: Math.min(index, source.length) });
  }
  return tokens;
}

/** Top-level function spans preserve offsets so inactive stages can be blanked without changing lines. */
export function getShaderSourceFunctions(source: string, language: ShaderLanguageId): ShaderSourceFunction[] {
  if (language === "glsl") {
    return [];
  }
  const tokens = tokenizeShaderSource(source);
  const functions: ShaderSourceFunction[] = [];
  let statementStart = 0;
  let depth = 0;
  let opening = -1;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.text === "{") {
      if (depth === 0) {
        opening = index;
      }
      depth++;
    } else if (token.text === "}") {
      depth = Math.max(0, depth - 1);
      if (depth !== 0 || opening < 0) {
        continue;
      }
      const header = tokens.slice(statementStart, opening);
      const signature = findFunctionSignature(header, language);
      if (signature) {
        functions.push({ name: signature.name, stage: signature.stage,
          start: header[0]!.start, end: token.end,
          bodyStart: tokens[opening]!.end, bodyEnd: token.start });
      }
      statementStart = index + 1;
      opening = -1;
    } else if (token.text === ";" && depth === 0) {
      statementStart = index + 1;
    }
  }
  return functions;
}

function isStage(name: string | undefined): name is NativeShaderStage {
  return name === "vertex" || name === "fragment" || name === "compute";
}

function findFunctionSignature(tokens: ShaderSourceToken[], language: ShaderLanguageId): ShaderEntryPoint | { name: string; stage?: NativeShaderStage } | undefined {
  return language === "wgsl" ? findWgslSignature(tokens) : findSlangSignature(tokens);
}

function findWgslSignature(tokens: ShaderSourceToken[]): { name: string; stage?: NativeShaderStage } | undefined {
  const fn = tokens.findIndex(token => token.text === "fn");
  if (fn < 0 || tokens[fn + 1]?.kind !== "identifier") {
    return undefined;
  }
  let stage: NativeShaderStage | undefined;
  for (let index = 0; index < fn; index++) {
    if (tokens[index]?.text === "@" && isStage(tokens[index + 1]?.text)) {
      stage = tokens[index + 1]!.text as NativeShaderStage;
    }
  }
  return { name: tokens[fn + 1]!.text, stage };
}

function findSlangSignature(tokens: ShaderSourceToken[]): { name: string; stage?: NativeShaderStage } | undefined {
  let stage: NativeShaderStage | undefined;
  let brackets = 0;
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (text === "[") {
      brackets++;
    } else if (text === "]") {
      brackets = Math.max(0, brackets - 1);
    }
    if (brackets > 0 && text === "shader" && tokens[index + 1]?.text === "(") {
      const quoted = tokens[index + 2]?.text;
      const candidate = quoted?.slice(1, -1);
      if (quoted?.startsWith('"') && isStage(candidate)) {
        stage = candidate;
      }
    }
    if (brackets === 0 && text === "=") {
      return undefined;
    }
    if (brackets === 0 && text === "(" && tokens[index - 1]?.kind === "identifier") {
      if (tokens.some(token => ["struct", "class", "namespace", "interface"].includes(token.text))) {
        return undefined;
      }
      return { name: tokens[index - 1]!.text, stage };
    }
  }
  return undefined;
}

export function getShaderEntryPoints(source: string, language: ShaderLanguageId): ShaderEntryPoint[] {
  return getShaderSourceFunctions(source, language)
    .filter((fn): fn is ShaderSourceFunction & { stage: NativeShaderStage } => fn.stage !== undefined)
    .map(({ name, stage }) => ({ name, stage }));
}

/** Viewer defaults are transient: callers persist them only after a user edit. */
export function withDefaultRenderEntryPoints(
  config: ShaderConfig | null,
  source: string,
  language: ShaderLanguageId,
): ShaderConfig | null {
  if (config !== null) {
    return config;
  }
  const entryPoints: { vertex?: string; fragment?: string } = {};
  for (const entry of getShaderEntryPoints(source, language)) {
    if (entry.stage !== "compute" && entryPoints[entry.stage] === undefined) {
      entryPoints[entry.stage] = entry.name;
    }
  }
  if (!entryPoints.vertex && !entryPoints.fragment) {
    return null;
  }
  return { version: "1.0", passes: { Image: { inputs: {}, entryPoints } } };
}
