import { applySourceEdits } from "@shader-studio/utils";
import type { ShaderLanguageId } from "@shader-studio/types";
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
  const header = language === "wgsl"
    ? replay.wrapperHeader.replace(/->\s*[^\s]+\s*$/, depth ? `-> ${displayType} ` : "-> @location(0) vec4f ")
    : replay.wrapperHeader.replace(new RegExp(`\\b${replay.returnType}\\s+${replay.entryName}\\b`), `${depth ? displayType : "float4"} ${replay.entryName}`).replace(/\s*:\s*SV_Target\d*\s*$/, depth ? "" : " : SV_Target");
  const color = replay.colorExpression("result");
  const returned = depth ? `${displayType}(${color}, result.${depth})` : color;
  const wrapper = `${declaration}\n${header}{\n  ${language === "wgsl" ? "let" : replay.returnType} result${language === "wgsl" ? `: ${replay.returnType}` : ""} = ${replay.call};\n  return ${returned};\n}\n`;
  const applied = applySourceEdits(source, [...replay.edits, { start: source.length, end: source.length, text: wrapper }]);
  return applied.ok ? applied.source : null;
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
