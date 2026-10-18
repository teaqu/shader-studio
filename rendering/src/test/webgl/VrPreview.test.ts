import { describe, expect, it } from "vitest";
import { VrPreview } from "../../webgl/VrPreview";
import type { Pass } from "../../models/Pass";

const vr = "void mainVR(out vec4 c, vec2 p, vec3 o, vec3 d) {}";
const image = (source = vr, geometry: Pass['geometry'] = "fullscreen"): Pass => ({ name: "Image", shaderSrc: source, inputs: {}, geometry });

describe("VR preview control", () => {
  it("is off by default and unavailable without a fullscreen mainVR definition", () => {
    const preview = new VrPreview();
    preview.setEnabled(true);
    expect(preview.enabled).toBe(false);
    for (const passes of [[], [image("void mainImage() {}")], [image(vr, "sphere")], [{ ...image(), name: "BufferA" }]]) {
      preview.update("a", passes);
      expect(preview.available).toBe(false);
    }
  });
  it("preserves the choice through edits, resets on shader switches or removed mainVR", () => {
    const preview = new VrPreview();
    preview.update("a", [image()]);
    expect(preview.available).toBe(true);
    expect(preview.enabled).toBe(false);
    preview.setEnabled(true);
    preview.update("a", [image()]);
    expect(preview.enabled).toBe(true);
    preview.update("b", [image()]);
    expect(preview.enabled).toBe(false);
    preview.setEnabled(true);
    preview.update("b", [image("")]);
    expect(preview.enabled).toBe(false);
  });
  it("accepts definitions in common but ignores commented declarations", () => {
    const preview = new VrPreview();
    preview.update("a", [image(""), { ...image(), name: "common" }]);
    expect(preview.available).toBe(true);
    preview.update("a", [image(`// ${vr}`)]);
    expect(preview.available).toBe(false);
  });
});
