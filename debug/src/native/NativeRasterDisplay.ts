import { applySourceEdits } from "@shader-studio/utils";
import { tokenizeShaderSource, type ShaderLanguageId } from "@shader-studio/types";
import { buildNativeRasterReplay } from "./NativeRasterReplay";

/** Projects one native MRT attachment into a temporary location-zero display fragment. */
export function projectNativeRasterDisplay(
  source: string,
  language: ShaderLanguageId,
  entryPoint: string | undefined,
  output = 0,
): string | null {
  const replay = buildNativeRasterReplay(source, language, entryPoint, "_ssdbg_display", output);
  if (typeof replay === "string") {
    return null;
  }
  const depth = depthField(source, language, replay.returnType);
  const displayType = `${"_ssdbg_display_out"}`;
  const declaration = depth
    ? language === "wgsl"
      ? `\nstruct ${displayType} { @location(0) color: vec4f, @builtin(frag_depth) depth: f32, }\n`
      : `\nstruct ${displayType} { float4 color : SV_Target; float depth : SV_Depth; };\n`
    : "";
  const header = displayHeader(replay.wrapperHeader, language, replay.entryName, depth ? displayType : undefined);
  const color = replay.colorExpression("result");
  const returned = depth ? `${displayType}(${color}, result.${depth})` : color;
  const wrapper = `${declaration}\n${header}{\n  ${language === "wgsl" ? "let" : replay.returnType} result${language === "wgsl" ? `: ${replay.returnType}` : ""} = ${replay.call};\n  return ${returned};\n}\n`;
  const applied = applySourceEdits(source, [...replay.edits, { start: source.length, end: source.length, text: wrapper }]);
  return applied.ok ? applied.source : null;
}

function displayHeader(header: string, language: ShaderLanguageId, entryName: string, depthType?: string): string {
  const tokens = tokenizeShaderSource(header);
  if (language === "wgsl") {
    const arrow = tokens.find((token, index) => token.text === "-" && tokens[index + 1]?.text === ">");
    return header.slice(0, arrow!.start) + (depthType ? `-> ${depthType} ` : "-> @location(0) vec4f ");
  }
  const entryIndex = tokens.findIndex((token, index) => token.text === entryName && tokens[index + 1]?.text === "(");
  const returnToken = tokens[entryIndex - 1]!;
  const end = tokens.filter(token => token.text === ")").slice(-1)[0]!.end;
  return header.slice(0, returnToken.start) + (depthType ?? "float4")
    + header.slice(returnToken.end, end) + (depthType ? " " : " : SV_Target ");
}

function depthField(source: string, language: ShaderLanguageId, returnType: string): string | undefined {
  const escaped = returnType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = new RegExp(`\\bstruct\\s+${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1];
  if (!body) {
    return undefined;
  }
  return language === "wgsl"
    ? /@builtin\(frag_depth\)\s*([A-Za-z_]\w*)\s*:\s*f32/.exec(body)?.[1]
    : /float\s+([A-Za-z_]\w*)\s*:\s*SV_Depth/.exec(body)?.[1];
}
