import { getShaderSourceFunctions, tokenizeShaderSource } from "@shader-studio/types";
import type { DebugSourceEdit, ShaderLanguageId } from "@shader-studio/types";

export interface NativeFragmentReplay {
  entryName: string;
  edits: DebugSourceEdit[];
  call: string;
}

/** Replay an explicitly selected native fragment over the existing pixel grid. */
export function buildNativeFragmentReplay(
  source: string,
  language: ShaderLanguageId,
  entryName: string | undefined,
  prefix: string,
): NativeFragmentReplay | string {
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
  let signature = header;
  let argumentsExpression = "";
  if (language === "wgsl") {
    const match = /^([\s\S]*?)fn\s+[A-Za-z_]\w*\s*\(([\s\S]*?)\)\s*->\s*@location\s*\(\s*0\s*\)\s*(vec4f|vec4\s*<\s*f32\s*>)\s*$/.exec(header);
    if (!match) {
      return limitation(language);
    }
    const parameters = match[2]!.trim();
    const position = /^@builtin\s*\(\s*position\s*\)\s*([A-Za-z_]\w*)\s*:\s*(vec4f|vec4\s*<\s*f32\s*>)\s*,?$/.exec(parameters);
    if (parameters && !position) {
      return limitation(language);
    }
    if (position) {
      argumentsExpression = "vec4f(coord.x, iResolution.y - coord.y, 0.0, 1.0)";
    }
    signature = header.replace(/@fragment\b/g, " ").replace(/@builtin\s*\(\s*position\s*\)/g, " ").replace(/@location\s*\(\s*0\s*\)/g, " ");
  } else {
    const unannotated = header.replace(/\[\s*shader\s*\(\s*"fragment"\s*\)\s*\]/g, " ");
    const match = /^\s*(?:public\s+)?float4\s+[A-Za-z_]\w*\s*\(([\s\S]*?)\)\s*:\s*SV_Target(?:0)?\s*$/.exec(unannotated);
    if (!match) {
      return limitation(language);
    }
    const parameters = match[1]!.trim();
    const position = /^float4\s+([A-Za-z_]\w*)\s*:\s*SV_Position\s*$/.exec(parameters);
    if (parameters && !position) {
      return limitation(language);
    }
    if (position) {
      argumentsExpression = "float4(fragCoord.x, iResolution.y - fragCoord.y, 0.0, 1.0)";
    }
    signature = unannotated.replace(/\s*:\s*SV_Position\b/g, "").replace(/\s*:\s*SV_Target(?:0)?\s*$/, "");
  }
  // A single signature replacement avoids overlapping name and annotation edits.
  const renameAt = tokenizeShaderSource(signature).find(token => token.text === entry.name)?.start;
  if (renameAt === undefined) {
    return "The native fragment signature could not be rewritten.";
  }
  signature = signature.slice(0, renameAt) + `${prefix}_userMain` + signature.slice(renameAt + name.text.length);
  return {
    entryName: entry.name,
    edits: [{ start: entry.start, end: entry.bodyStart - 1, text: signature }, ...preserveLegacyMainImage(source, language, prefix)],
    call: `${prefix}_userMain(${argumentsExpression})`,
  };
}

/** A shared module can retain a legacy Image alongside a native buffer or compute stage. */
export function preserveLegacyMainImage(source: string, language: ShaderLanguageId, prefix: string): DebugSourceEdit[] {
  if (!getShaderSourceFunctions(source, language).some(fn => fn.name === "mainImage" && fn.stage === undefined)) {
    return [];
  }
  return tokenizeShaderSource(source).filter(token => token.kind === "identifier" && token.text === "mainImage")
    .map(token => ({ start: token.start, end: token.end, text: `${prefix}_legacyMainImage` }));
}

function limitation(language: ShaderLanguageId): string {
  return `${language === "wgsl" ? "WGSL" : "Slang"} native fragment debugging supports a location-0 four-component color with no parameters or a position builtin. Interpolated inputs, sample builtins and structured outputs require raster replay; use ShaderToy hooks for those debug operations.`;
}
