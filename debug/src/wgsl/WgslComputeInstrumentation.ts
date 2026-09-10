import { getWgslComputeEntryPoints, tokenizeWgsl, type WgslAnalysisDocument, type WgslToken } from "@shader-studio/wgsl-analysis";
import type { DebugSourceEdit } from "@shader-studio/types";

export interface WgslComputeInstrumentation {
  entryName: string;
  edits: DebugSourceEdit[];
  declarations: string[];
  call: string;
}

export interface WgslComputeDebugOptions {
  entryPoint?: string;
  storageNames?: string[];
}

const REPLAY_UNSAFE_OPERATIONS = new Set(["workgroupUniformLoad", "textureStore", "workgroupBarrier", "storageBarrier", "textureBarrier", "atomicAdd", "atomicAnd", "atomicCompareExchangeWeak", "atomicExchange", "atomicLoad", "atomicMax", "atomicMin", "atomicOr", "atomicStore", "atomicSub", "atomicXor"]);

/**
 * Turns a native compute entry into a callable replayed by the debug render
 * wrapper. The wrapper supplies synthetic invocation builtins from its pixel
 * coordinate; all cooperative and persistent operations are rejected because
 * one fragment invocation cannot faithfully reproduce them.
 */
export function buildWgslComputeInstrumentation(
  source: string,
  document: WgslAnalysisDocument,
  prefix: string,
  compute?: WgslComputeDebugOptions,
): WgslComputeInstrumentation | string | undefined {
  // A render module can also declare unused compute entry points.
  if (!compute && document.symbols.some(symbol => symbol.kind === "function" && symbol.name === "mainImage")) return undefined;
  const entries = getWgslComputeEntryPoints(source);
  if (entries.length === 0) return compute
    ? "WGSL compute replay requires a native compute entry with literal workgroup dimensions." : undefined;
  const selected = compute?.entryPoint
    ? entries.find(entry => entry.name === compute?.entryPoint)
    : entries.length === 1 ? entries[0] : undefined;
  if (!selected) return compute?.entryPoint
    ? `WGSL compute entry '${compute?.entryPoint}' was not found.`
    : "WGSL debugging cannot replay an ambiguous compute entry; configure entryPoint.";

  const tokens = tokenizeWgsl(source);
  if (tokens.some(token => (REPLAY_UNSAFE_OPERATIONS.has(token.text) || token.text.startsWith("subgroup")))) {
    return "WGSL compute replay does not support barriers, atomics, or cooperative storage operations.";
  }
  if (hasWorkgroupMemory(tokens)) return "WGSL compute replay does not support workgroup memory.";
  if (writesConfiguredStorage(tokens, new Set(compute?.storageNames ?? []))) {
    return "WGSL compute replay does not support writes to configured storage.";
  }

  const fnIndex = tokens.findIndex((token, index) => token.text === "fn" && tokens[index + 1]?.text === selected.name);
  if (fnIndex < 0) return `WGSL compute entry '${selected.name}' could not be located.`;
  const bodyIndex = findBodyStart(tokens, fnIndex);
  if (bodyIndex < 0) return `WGSL compute entry '${selected.name}' has no body.`;
  const parameters = parseBuiltinParameters(tokens, fnIndex, bodyIndex);
  if (typeof parameters === "string") return parameters;

  const functionSymbol = document.symbols.find(symbol => symbol.kind === "function" && symbol.name === selected.name);
  if (!functionSymbol) return `WGSL compute entry '${selected.name}' could not be analysed.`;
  const nameToken = tokens[fnIndex + 1]!;
  const edits: DebugSourceEdit[] = [
    { start: nameToken.offset, end: nameToken.offset + nameToken.text.length, text: `${prefix}_userMain` },
    ...computeAttributeEdits(tokens, fnIndex, source),
    ...parameters.flatMap(parameter => attributeEdit(parameter.attribute, source)),
  ];

  const output = outputStub(tokens);
  if (output?.error) return output.error;
  const dimensions = `vec3u(${selected.workgroupSize[0]}u, ${selected.workgroupSize[1]}u, ${selected.workgroupSize[2]}u)`;
  const argumentsByBuiltin: Record<string, string> = {
    global_invocation_id: `${prefix}_gid`,
    local_invocation_id: `${prefix}_lid`,
    workgroup_id: `${prefix}_wid`,
    local_invocation_index: `${prefix}_index`,
  };
  const callArguments = parameters.map(parameter => argumentsByBuiltin[parameter.builtin]).join(", ");
  const declarations = [
    ...(declaresIDispatch(tokens) ? [] : ["var<private> iDispatch: i32 = 0;"]),
    ...(output?.declaration ? [output.declaration] : []),
  ];
  const call = [
    `let ${prefix}_gid = vec3u(vec2u(coord), 0u);`,
    `let ${prefix}_lid = ${prefix}_gid % ${dimensions};`,
    `let ${prefix}_wid = ${prefix}_gid / ${dimensions};`,
    `let ${prefix}_index = (u32(coord.y) % ${selected.workgroupSize[1]}u) * ${selected.workgroupSize[0]}u + (u32(coord.x) % ${selected.workgroupSize[0]}u);`,
    `${prefix}_userMain(${callArguments});`,
  ].join("\n  ");
  return { entryName: selected.name, edits, declarations, call };
}

function findBodyStart(tokens: readonly WgslToken[], fnIndex: number): number {
  for (let index = fnIndex + 2; index < tokens.length; index += 1) {
    if (tokens[index]?.text === "{") return index;
  }
  return -1;
}

interface BuiltinParameter { builtin: string; attribute: WgslToken[]; }

const BUILTIN_PARAMETER_TYPES: Record<string, readonly string[]> = {
  global_invocation_id: ["vec3u", "vec3<u32>"],
  local_invocation_id: ["vec3u", "vec3<u32>"],
  workgroup_id: ["vec3u", "vec3<u32>"],
  local_invocation_index: ["u32"],
};

function parseBuiltinParameters(tokens: readonly WgslToken[], fnIndex: number, bodyIndex: number): BuiltinParameter[] | string {
  const open = tokens.findIndex((token, index) => index > fnIndex && token.text === "(");
  if (open < 0 || open >= bodyIndex) return "WGSL compute entry parameters could not be read.";
  const parameters: BuiltinParameter[] = [];
  let index = open + 1;
  while (index < bodyIndex && tokens[index]?.text !== ")") {
    const attribute = readAttribute(tokens, index);
    if (!attribute || attribute.name !== "builtin") return "WGSL compute replay only supports @builtin entry parameters.";
    const builtin = attribute.values[0];
    const name = tokens[attribute.end]?.text;
    if (!builtin || !name || !Object.prototype.hasOwnProperty.call(BUILTIN_PARAMETER_TYPES, builtin) || tokens[attribute.end + 1]?.text !== ":") {
      return "WGSL compute replay encountered an unsupported entry parameter.";
    }
    let cursor = attribute.end + 2;
    let angleDepth = 0;
    const typeTokens: string[] = [];
    while (cursor < bodyIndex) {
      const token = tokens[cursor]!;
      if (token.text === "<") angleDepth += 1;
      if (token.text === ">") angleDepth -= 1;
      if (angleDepth === 0 && (token.text === "," || token.text === ")")) break;
      typeTokens.push(token.text);
      cursor += 1;
    }
    if (!BUILTIN_PARAMETER_TYPES[builtin]!.includes(typeTokens.join(""))) {
      return `WGSL compute replay requires @builtin(${builtin}) to use its native WGSL type.`;
    }
    parameters.push({ builtin, attribute: attribute.tokens });
    index = cursor;
    if (tokens[index]?.text === ",") index += 1;
  }
  return parameters;
}

function readAttribute(tokens: readonly WgslToken[], start: number): { name: string; values: string[]; end: number; tokens: WgslToken[] } | undefined {
  if (tokens[start]?.kind !== "attribute") return undefined;
  const name = tokens[start + 1]?.text;
  let end = start + 2;
  const attributeTokens = [tokens[start]!, tokens[start + 1]!];
  const values: string[] = [];
  if (tokens[end]?.text === "(") {
    let depth = 0;
    for (; end < tokens.length; end += 1) {
      const token = tokens[end]!;
      attributeTokens.push(token);
      if (token.text === "(") depth += 1;
      else if (token.text === ")" && --depth === 0) { end += 1; break; }
      else if (depth === 1 && token.kind === "identifier") values.push(token.text);
    }
  }
  return name ? { name, values, end, tokens: attributeTokens } : undefined;
}

function computeAttributeEdits(tokens: readonly WgslToken[], fnIndex: number, source: string): DebugSourceEdit[] {
  const edits: DebugSourceEdit[] = [];
  for (let index = fnIndex - 1; index >= 0 && tokens[index]?.text !== "}" && tokens[index]?.text !== ";"; index -= 1) {
    if (tokens[index]?.kind !== "attribute") continue;
    const attribute = readAttribute(tokens, index);
    if (attribute && (attribute.name === "compute" || attribute.name === "workgroup_size")) edits.push(...attributeEdit(attribute.tokens, source));
  }
  return edits;
}

function attributeEdit(tokens: readonly WgslToken[], source: string): DebugSourceEdit[] {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return [];
  let end = last.offset + last.text.length;
  while (source[end] === " " || source[end] === "\t" || source[end] === "\r" || source[end] === "\n") end += 1;
  return [{ start: first.offset, end, text: "" }];
}

function hasWorkgroupMemory(tokens: readonly WgslToken[]): boolean {
  return tokens.some((token, index) => token.text === "var" && tokens[index + 1]?.text === "<" && tokens[index + 2]?.text === "workgroup");
}

function writesConfiguredStorage(tokens: readonly WgslToken[], storageNames: ReadonlySet<string>): boolean {
  if (storageNames.size === 0) return false;
  return tokens.some((token, index) => {
    if (!storageNames.has(token.text)) return false;
    if (tokens[index - 1]?.text === "&") return true;
    let cursor = index + 1;
    while (cursor < tokens.length) {
      if (tokens[cursor]?.text === "[") {
        let depth = 0;
        do {
          const selector = tokens[cursor++]?.text;
          if (selector === "[") depth += 1;
          else if (selector === "]") depth -= 1;
        } while (cursor < tokens.length && depth > 0);
      } else if (tokens[cursor]?.text === "." && tokens[cursor + 1]?.kind === "identifier") {
        cursor += 2;
      } else break;
    }
    return ["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", "++", "--"].includes(tokens[cursor]?.text ?? "");
  });
}

function declaresIDispatch(tokens: readonly WgslToken[]): boolean {
  return tokens.some((token, index) => token.text === "iDispatch"
    && ["var", "let", "const", "override"].includes(tokens[index - 1]?.text ?? ""));
}

function outputStub(tokens: readonly WgslToken[]): { declaration?: string; error?: string } | undefined {
  if (tokens.some((token, index) => token.text === "fn" && tokens[index + 1]?.text === "writeOutput")) return undefined;
  const arities = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.text !== "writeOutput" || tokens[index + 1]?.text !== "(") continue;
    let depth = 0;
    let arity = 1;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.text === "(") depth += 1;
      else if (token.text === ")" && --depth === 0) break;
      else if (token.text === "," && depth === 1) arity += 1;
    }
    arities.add(arity);
  }
  if (arities.size === 0) return undefined;
  if (arities.size !== 1) return { error: "WGSL compute replay requires writeOutput calls to use one arity." };
  return arities.has(3)
    ? { declaration: "fn writeOutput(coord: vec2u, layer: u32, color: vec4f) {}" }
    : arities.has(2) ? { declaration: "fn writeOutput(coord: vec2u, color: vec4f) {}" } : { error: "WGSL compute replay only supports two- or three-argument writeOutput." };
}
