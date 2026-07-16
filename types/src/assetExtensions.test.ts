import { describe, expect, it } from "vitest";
import {
  AUDIO_EXTENSIONS,
  CUBEMAP_EXTENSIONS,
  GLSL_EXTENSIONS,
  SCRIPT_EXTENSIONS,
  TEXTURE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./assetExtensions";

describe("asset extension filters", () => {
  const extensionLists = [
    GLSL_EXTENSIONS,
    SCRIPT_EXTENSIONS,
    TEXTURE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    CUBEMAP_EXTENSIONS,
  ];

  it("keeps every extension lowercase, dotless, non-empty, and unique within its filter", () => {
    for (const extensions of extensionLists) {
      expect(extensions.length).toBeGreaterThan(0);
      expect(new Set(extensions).size).toBe(extensions.length);
      for (const extension of extensions) {
        expect(extension).toBe(extension.toLowerCase());
        expect(extension).not.toMatch(/^\./);
        expect(extension.trim()).toBe(extension);
        expect(extension).not.toBe("");
      }
    }
  });

  it("includes SVG anywhere image assets are browsed", () => {
    expect(TEXTURE_EXTENSIONS).toContain("svg");
    expect(CUBEMAP_EXTENSIONS).toContain("svg");
  });

  it("allows video containers to be selected as shader audio inputs", () => {
    expect(AUDIO_EXTENSIONS).toEqual(expect.arrayContaining(["mp4", "webm", "mov"]));
  });

  it("keeps cubemap browser formats texture-compatible", () => {
    for (const extension of CUBEMAP_EXTENSIONS) {
      expect(TEXTURE_EXTENSIONS).toContain(extension);
    }
  });
});
