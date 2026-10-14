import { describe, expect, it } from "vitest";
import { ConfigValidator } from "../../util/ConfigValidator";

function validate(input: unknown) {
  return ConfigValidator.validateConfig({
    version: "1.0",
    passes: { Image: { inputs: { density: input } } },
  } as never);
}

describe("volume input config validation", () => {
  it("accepts a path with default sampling and explicit volume sampling", () => {
    expect(validate({ type: "volume", path: "density.ktx2" })).toEqual({ isValid: true, errors: [] });
    expect(validate({ type: "volume", path: "density.ktx2", filter: "nearest", wrap: "clamp" }))
      .toEqual({ isValid: true, errors: [] });
  });

  it.each([
    { type: "volume" },
    { type: "volume", path: "" },
    { type: "volume", path: 7 },
    { type: "volume", path: "density.ktx2", filter: "mipmap" },
    { type: "volume", path: "density.ktx2", filter: true },
    { type: "volume", path: "density.ktx2", wrap: "mirror" },
    { type: "volume", path: "density.ktx2", wrap: false },
  ])("rejects invalid volume settings: %j", input => {
    expect(validate(input).errors).toContain("Image pass has invalid input configuration for density");
  });
});
