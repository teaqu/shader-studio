import type { NativeRasterReplay } from "./NativeRasterReplay";

export interface NativeRasterSlot { typeName: string; expression: string; }

/** Wrapper stays in the real fragment stage; vertex interpolation and depth remain GPU-owned. */
export function emitNativeRasterWrapper(
  replay: NativeRasterReplay,
  language: "wgsl" | "slang",
  prefix: string,
  mode: "preview" | "capture",
  slots: NativeRasterSlot[],
  previewColor: () => string,
  emitFloat4: (type: string, expression: string) => string,
  setup: string[],
  executed = `${prefix}_executed`,
  reset = true,
): string {
  const result = `${prefix}_result`;
  const declaration = language === "wgsl"
    ? `var ${result} = ${replay.call};`
    : `${replay.returnType} ${result} = ${replay.call};`;
  const output = (color: string) => replay.returnColor(result, color);
  const outputs = mode === "preview"
    ? [`if (${executed}) { ${output(previewColor())} }`]
    : [
      `if (${language === "wgsl" ? "_ss_dbgCapU.varIndex" : "_dbgVarIndex"} == 0) { ${output(language === "wgsl" ? `vec4f(f32(${executed}), 0.0, 0.0, 1.0)` : `float4(${executed} ? 1.0 : 0.0, 0.0, 0.0, 1.0)`)} }`,
      ...slots.map((slot, index) => `if (${language === "wgsl" ? "_ss_dbgCapU.varIndex" : "_dbgVarIndex"} == ${index + 1}) { ${output(emitFloat4(slot.typeName, slot.expression))} }`),
    ];
  const coordinateAlias = language === "wgsl" ? /\bcoord\b/g : /\bfragCoord\b/g;
  const rasterSetup = setup.map(statement => statement.replace(coordinateAlias, replay.coordinateName));
  return `${replay.wrapperHeader}{\n  ${reset ? `${executed} = false;` : ""}\n  ${replay.coordinateSetup}\n  ${rasterSetup.join("\n  ")}\n  ${declaration}\n  ${outputs.join("\n  ")}\n  return ${result};\n}`;
}
