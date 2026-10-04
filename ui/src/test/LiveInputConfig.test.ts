import { describe, expect, it } from "vitest";
import { BufferConfig } from "../lib/BufferConfig";

describe("live device config", () => {
  it.each(["webcam", "microphone", "system-audio", "screen"] as const)("validates and persists %s without a file path", type => {
    const config = new BufferConfig("Image", {});
    config.updateInputChannel("live", { type });
    expect(config.validate()).toEqual({ isValid: true, errors: [] });
    expect(JSON.parse(JSON.stringify(config.getConfig())).inputs.live).toEqual({ type });
  });

  it('persists screen sampling settings', () => {
    const config = new BufferConfig('Image', {});
    config.updateInputChannel('live', { type: 'screen', filter: 'nearest', wrap: 'repeat', vflip: false });
    expect(config.validate()).toEqual({ isValid: true, errors: [] });
    expect(config.getConfig().inputs!.live).toEqual({ type: 'screen', filter: 'nearest', wrap: 'repeat', vflip: false });
  });
});
