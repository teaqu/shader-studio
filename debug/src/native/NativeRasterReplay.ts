import { getShaderSourceFunctions, tokenizeShaderSource } from "@shader-studio/types";
import type { DebugSourceEdit, ShaderLanguageId, ShaderSourceToken } from "@shader-studio/types";
import { nativeRasterCoordinates } from "./NativeRasterCoordinates";

export interface NativeRasterReplay {
  entryName: string;
  edits: DebugSourceEdit[];
  call: string;
  wrapperHeader: string;
  returnType: string;
  coordinateSetup: string;
  coordinateName: string;
  colorExpression: (result: string) => string;
  returnColor: (result: string, color: string) => string;
}

/** Demote only the selected stage; its wrapper keeps the authored raster interface. */
export function buildNativeRasterReplay(
  source: string,
  language: ShaderLanguageId,
  entryName: string | undefined,
  prefix: string,
  output = 0,
): NativeRasterReplay | string {
  const entries = getShaderSourceFunctions(source, language).filter(fn => fn.stage === "fragment");
  const entry = entryName ? entries.find(fn => fn.name === entryName) : entries.length === 1 ? entries[0] : undefined;
  if (!entry) {
    return entryName ? `Native fragment entry '${entryName}' was not found.` : "Select a native fragment entry point before debugging.";
  }
  const header = source.slice(entry.start, entry.bodyStart - 1);
  const tokens = tokenizeShaderSource(header);
  const nameIndex = tokens.findIndex((token, index) => token.text === entry.name && tokens[index + 1]?.text === "(");
  if (nameIndex < 0) {
    return "The native fragment signature could not be analyzed.";
  }
  const name = tokens[nameIndex]!;
  const close = matchingClose(tokens, nameIndex + 1, "(", ")");
  if (close < 0) {
    return "The native fragment parameter list is incomplete.";
  }
  const parameters = splitParameters(tokens.slice(nameIndex + 2, close));
  const argumentNames = parameters.map(parameter => parameterName(parameter, language));
  if (argumentNames.some(argument => argument === undefined)) {
    return "The native fragment parameters could not be analyzed.";
  }
  const returnType = language === "wgsl"
    ? wgslReturnType(tokens.slice(close + 1))
    : tokens.slice(0, nameIndex).filter(token => token.kind === "identifier" && token.text !== "public").slice(-1)[0]?.text;
  if (!returnType) {
    return "The native fragment return type could not be analyzed.";
  }
  const color = resolveColor(source, language, returnType, tokens.slice(close + 1), output);
  if (color === undefined) {
    return "Native fragment debugging requires the selected location four-component floating-point color output.";
  }
  const stripped = signatureInterfaceEdits(tokens, language);
  const coordinates = nativeRasterCoordinates(source, header, language as "wgsl" | "slang", prefix, entry.name);
  const edits = [
    { start: name.start + entry.start, end: name.end + entry.start, text: `${prefix}_userMain` },
    ...stripped.map(edit => ({ ...edit, start: edit.start + entry.start, end: edit.end + entry.start })),
  ];
  return {
    entryName: entry.name,
    edits,
    call: `${prefix}_userMain(${argumentNames.join(", ")})`,
    wrapperHeader: coordinates.header,
    coordinateSetup: coordinates.setup,
    coordinateName: coordinates.name,
    returnType,
    colorExpression: result => color === "" ? result : `${result}.${color}`,
    returnColor: (result, expression) => color === ""
      ? `return ${expression};`
      : `${result}.${color} = ${expression}; return ${result};`,
  };
}

function matchingClose(tokens: ShaderSourceToken[], start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index]!.text === open) {
      depth++;
    }
    if (tokens[index]!.text === close && --depth === 0) {
      return index;
    }
  }
  return -1;
}

function splitParameters(tokens: ShaderSourceToken[]): ShaderSourceToken[][] {
  const parameters: ShaderSourceToken[][] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (["(", "[", "<"].includes(text)) {
      depth++;
    }
    if ([")", "]", ">"].includes(text)) {
      depth--;
    }
    if (text === "," && depth === 0) {
      if (index > start) {
        parameters.push(tokens.slice(start, index));
      }
      start = index + 1;
    }
  }
  if (start < tokens.length) {
    parameters.push(tokens.slice(start));
  }
  return parameters;
}

function parameterName(tokens: ShaderSourceToken[], language: ShaderLanguageId): string | undefined {
  const colon = tokens.findIndex(token => token.text === ":");
  if (language === "wgsl") {
    return colon > 0 ? tokens[colon - 1]?.text : undefined;
  }
  const declaration = colon >= 0 ? tokens.slice(0, colon) : tokens;
  if (declaration.some(token => ["out", "inout"].includes(token.text))) {
    return undefined;
  }
  return declaration.filter(token => token.kind === "identifier").slice(-1)[0]?.text;
}

function wgslReturnType(tokens: ShaderSourceToken[]): string | undefined {
  const arrow = tokens.findIndex((token, index) => token.text === "-" && tokens[index + 1]?.text === ">");
  if (arrow < 0) {
    return undefined;
  }
  const typeTokens = tokens.slice(arrow + 2);
  const lastAttribute = signatureInterfaceEdits(typeTokens, "wgsl").slice(-1)[0];
  return typeTokens.filter(token => !lastAttribute || token.start >= lastAttribute.end).map(token => token.text).join("");
}

function signatureInterfaceEdits(tokens: ShaderSourceToken[], language: ShaderLanguageId): DebugSourceEdit[] {
  const edits: DebugSourceEdit[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (language === "wgsl" && token.text === "@") {
      let end = index + 1;
      if (tokens[end + 1]?.text === "(") {
        end = matchingClose(tokens, end + 1, "(", ")");
      }
      if (end >= 0) {
        edits.push({ start: token.start, end: tokens[end]!.end, text: " " });
        index = end;
      }
    } else if (language === "slang" && token.text === "[" && tokens[index + 1]?.text === "shader") {
      const end = matchingClose(tokens, index, "[", "]");
      if (end >= 0) {
        edits.push({ start: token.start, end: tokens[end]!.end, text: " " }); index = end;
      }
    } else if (language === "slang" && token.text === ":") {
      const semantic = tokens[index + 1];
      if (semantic?.kind === "identifier") {
        edits.push({ start: token.start, end: semantic.end, text: " " }); index++;
      }
    }
  }
  return edits;
}

function resolveColor(source: string, language: ShaderLanguageId, type: string, outputTokens: ShaderSourceToken[], output: number): string | undefined {
  const isColorType = language === "wgsl" ? ["vec4f", "vec4<f32>"].includes(type) : type === "float4";
  if (isColorType) {
    const signature = outputTokens.map(token => token.text).join("");
    return language === "wgsl" ? new RegExp(`@location\\(${output}\\)`).test(signature) ? "" : undefined
      : new RegExp(`:SV_Target${output === 0 ? "0?" : output}$`).test(signature) ? "" : undefined;
  }
  const tokens = tokenizeShaderSource(source);
  const struct = tokens.findIndex((token, index) => token.text === "struct" && tokens[index + 1]?.text === type && tokens[index + 2]?.text === "{");
  if (struct < 0) {
    return undefined;
  }
  const end = matchingClose(tokens, struct + 2, "{", "}");
  const fields = splitFields(tokens.slice(struct + 3, end));
  for (const field of fields) {
    const text = field.map(token => token.text).join("");
    if (language === "wgsl") {
      const match = new RegExp(`@location\\(${output}\\)(?:@[A-Za-z_]\\w*(?:\\([^)]*\\))?)*([A-Za-z_]\\w*):(?:vec4f|vec4<f32>)$`).exec(text);
      if (match) {
        return match[1];
      }
    } else {
      const match = new RegExp(`float4([A-Za-z_]\\w*):SV_Target${output === 0 ? "0?" : output}$`).exec(text);
      if (match) {
        return match[1];
      }
    }
  }
  return undefined;
}

function splitFields(tokens: ShaderSourceToken[]): ShaderSourceToken[][] {
  const fields: ShaderSourceToken[][] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (["(", "[", "<"].includes(text)) {
      depth++;
    }
    if ([")", "]", ">"].includes(text)) {
      depth--;
    }
    if ([",", ";"].includes(text) && depth === 0) {
      fields.push(tokens.slice(start, index)); start = index + 1;
    }
  }
  if (start < tokens.length) {
    fields.push(tokens.slice(start));
  }
  return fields;
}
