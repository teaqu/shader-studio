import { describe, expect, it } from "vitest";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import { ConfigValidator } from "../../util/ConfigValidator";
import { audioLoadWarning, liveInputPaths, normalizeLiveInputs, WEBCAM_PATH, MICROPHONE_PATH } from "../../util/LiveInputConfig";
import type { ShaderConfig } from "@shader-studio/types";

const config: ShaderConfig = { version: "1", passes: { Image: { inputs: {
  camera: { type: "webcam" }, sound: { type: "microphone" }, keys: { type: "keyboard" },
} } } };

describe("live input configuration", () => {
  it("preserves actionable microphone failures and stable file-media warnings", () => {
    expect(audioLoadWarning(MICROPHONE_PATH, new Error("Allow microphone access"))).toBe("Allow microphone access");
    expect(audioLoadWarning(MICROPHONE_PATH, null)).toContain("Audio loading failed");
    expect(audioLoadWarning("music.mp3", new Error("decode failed"))).toBe("Audio loading failed: music.mp3");
  });
  it("collects only requested live identities across passes", () => {
    const inputs = normalizeLiveInputs(config.passes.Image.inputs!);
    expect(liveInputPaths([inputs, { movie: { type: "video", path: "clip.mp4" } }])).toEqual(new Set([WEBCAM_PATH, MICROPHONE_PATH]));
    expect(liveInputPaths([{}, { keys: { type: "keyboard" } }])).toEqual(new Set());
  });

  it("accepts pathless devices and keeps serialized config unchanged", () => {
    expect(ConfigValidator.validateConfig(config).isValid).toBe(true);
    const normalized = normalizeLiveInputs(config.passes.Image.inputs!);
    expect(normalized.camera).toEqual({ type: "video", path: WEBCAM_PATH, muted: true });
    expect(normalized.sound).toEqual({ type: "audio", path: MICROPHONE_PATH, muted: true });
    expect(normalized.keys).toBe(config.passes.Image.inputs!.keys);
    expect(config.passes.Image.inputs!.camera).toEqual({ type: "webcam" });
  });

  it.each(["webcam", "microphone"])("rejects unexpected device settings for %s", type => {
    const invalid = { version: "1", passes: { Image: { inputs: { live: { type, path: "file.mp4" } } } } };
    expect(ConfigValidator.validateConfig(invalid as ShaderConfig).isValid).toBe(false);
  });

  it.each(["slang", "wgsl"] as const)("routes named devices through %s media bindings", language => {
    const graph = buildSlangPassGraph({ imageCode: "", config, buffers: {}, canvasWidth: 100, canvasHeight: 100, language });
    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.passes.find(pass => pass.name === "Image")?.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "video", key: "camera", path: WEBCAM_PATH }),
      expect.objectContaining({ kind: "audio", key: "sound", path: MICROPHONE_PATH }),
    ]));
  });
});
