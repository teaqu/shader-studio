import { expect, it } from "vitest";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

it("renders with a WGSL storage struct containing an atomic field", { timeout: 30_000 }, async () => {
  const harness = createShaderCanvasHarness("wgsl");
  try {
    await harness.compile({
      image: `fn mainImage(coord: vec2f) -> vec4f {
        return resultSampleLevel(coord / iResolution.xy, 0.0);
      }`,
      buffers: {
        common: "struct Counter { value: atomic<u32>, }",
        Compute: `@compute @workgroup_size(1, 1, 1)
          fn fill(@builtin(global_invocation_id) id: vec3u) {
            atomicStore(&counter[0].value, 1u);
            writeOutput(id.xy, vec4f(f32(atomicLoad(&counter[0].value)), 0.0, 0.0, 1.0));
          }`,
      },
      config: {
        version: "1",
        storage: { counter: { count: 1, elementType: "Counter" } },
        passes: {
          Image: { inputs: { result: { type: "buffer", source: "Compute" } } },
          Compute: { type: "compute", path: "compute.wgsl", entryPoint: "fill", inputs: {} },
          common: { path: "common.wgsl" },
        },
      },
    });

    expect(await harness.renderAndReadPixels()).toEqual(Array.from({ length: 4 }, () => [255, 0, 0, 255]));
  } finally {
    harness.dispose();
  }
});
