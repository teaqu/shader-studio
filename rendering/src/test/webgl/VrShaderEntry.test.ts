import { describe, expect, it } from "vitest";
import { buildFragmentEntry } from "../../webgl/VrShaderEntry";
import { ShaderCompiler } from "../../webgl/ShaderCompiler";
import type { PiRenderer } from "../../types/piRenderer";

const vr = "void mainVR(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) { color = vec4(direction, 1.0); }";
const image = "void mainImage(out vec4 color, in vec2 coord) {}";

describe("desktop mainVR entry", () => {
  it("passes world-space camera origin and normalized perspective rays", () => {
    const entry = buildFragmentEntry(vr, "gl_FragCoord.xy", true);
    expect(entry).toContain("mainVR(fragColor, _ssVrCoord, iCameraPos, _ssVrDirection)");
    expect(entry).toContain("(2.0 * _ssVrCoord - iResolution.xy) / max(iResolution.y, 1.0)");
    expect(entry).toContain("normalize(_ssVrForward + _ssVrScreen.x * _ssVrRight + _ssVrScreen.y * _ssVrUp)");
    expect(entry).toContain("abs(_ssVrForward.y) > 0.999");
    expect(entry).toContain("length(iCameraDir) > 0.0");
  });
  it.each([image, `// ${vr}\n${image}`, `/* ${vr} */\n${image}`, "void mainVR(out vec4 c, vec2 p, vec3 o, vec3 d);"])("keeps the image entry for absent definitions: %s", (source) => {
    expect(buildFragmentEntry(source, "gl_FragCoord.xy", true)).toContain("mainImage(fragColor, gl_FragCoord.xy)");
  });
  it("uses mainVR when both entry points exist", () => {
    expect(buildFragmentEntry(image + vr, "gl_FragCoord.xy", true)).toContain("mainVR(fragColor");
  });
  it("retains mainImage for mesh geometry", () => {
    expect(buildFragmentEntry(vr + image, "_meshUv * iResolution.xy", false)).toContain("mainImage(fragColor, _meshUv * iResolution.xy)");
  });
  it("accepts multiline definitions and comment-separated tokens", () => {
    expect(buildFragmentEntry(vr.replace("void mainVR", "void /* entry */\nmainVR"), "gl_FragCoord.xy", true)).toContain("mainVR(fragColor");
  });
  it("keeps mainImage by default even with mainVR", () => {
    const compiler = new ShaderCompiler({} as PiRenderer);
    expect(compiler.wrapShaderToyCode(image + vr).wrappedCode).not.toContain("uniform bool _ssVrPreview");
  });
  it("wraps definitions in common code and explicit fullscreen geometry", () => {
    const compiler = new ShaderCompiler({} as PiRenderer);
    const wrapped = compiler.wrapShaderToyCode(image, { commonCode: vr, geometry: "fullscreen", vrPreview: true });
    expect(wrapped.wrappedCode).toContain("mainVR(fragColor");
    const mesh = compiler.wrapShaderToyCode(image + vr, { geometry: "sphere" });
    expect(mesh.wrappedCode).toContain("mainImage(fragColor, iVertexUv * iResolution.xy)");
  });
});
