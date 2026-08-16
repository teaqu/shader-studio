import { describe, expect, it } from "vitest";
import {
  createShaderCanvasHarness,
  TEST_CANVAS_SIZE,
  type Pixel,
  type ShaderLanguage,
  type ShaderProgram,
} from "./ShaderCanvasHarness";

interface ConformanceCase {
  name: string;
  expected: Pixel[];
  programs: Record<ShaderLanguage, ShaderProgram>;
}

const solid = (pixel: Pixel): Pixel[] =>
  Array.from({ length: TEST_CANVAS_SIZE ** 2 }, () => [...pixel] as Pixel);

const conformanceCases: ConformanceCase[] = [
  {
    name: "writes exact RGBA output",
    expected: solid([255, 0, 128, 255]),
    programs: {
      glsl: {
        image: "void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0, 0.0, 128.0 / 255.0, 1.0); }",
      },
      slang: {
        image: "float4 mainImage(float2 fragCoord) { return float4(1.0, 0.0, 128.0 / 255.0, 1.0); }",
      },
    },
  },
  {
    name: "uses bottom-left fragment coordinates and iResolution",
    expected: [
      [0, 255, 0, 255],
      [255, 255, 0, 255],
      [0, 0, 0, 255],
      [255, 0, 0, 255],
    ],
    programs: {
      glsl: {
        image: `void mainImage(out vec4 color, in vec2 fragCoord) {
          vec2 cell = step(iResolution.xy * 0.5, fragCoord);
          color = vec4(cell, 0.0, 1.0);
        }`,
      },
      slang: {
        image: `float4 mainImage(float2 fragCoord) {
          float2 cell = float2(
            fragCoord.x >= iResolution.x * 0.5,
            fragCoord.y >= iResolution.y * 0.5
          );
          return float4(cell, 0.0, 1.0);
        }`,
      },
    },
  },
  {
    name: "links and executes a common pass",
    expected: solid([0, 255, 255, 255]),
    programs: {
      glsl: {
        image: "void mainImage(out vec4 color, in vec2 fragCoord) { color = commonColor(); }",
        buffers: { common: "vec4 commonColor() { return vec4(0.0, 1.0, 1.0, 1.0); }" },
        config: { version: "1", passes: { Image: {}, common: { path: "common.glsl" } } },
      },
      slang: {
        image: "float4 mainImage(float2 fragCoord) { return commonColor(); }",
        buffers: { common: "float4 commonColor() { return float4(0.0, 1.0, 1.0, 1.0); }" },
        config: { version: "1", passes: { Image: {}, common: { path: "common.slang" } } },
      },
    },
  },
  {
    name: "binds script-defined custom uniforms",
    expected: solid([255, 255, 0, 255]),
    programs: {
      glsl: {
        image: "void mainImage(out vec4 color, in vec2 fragCoord) { color = testColor; }",
        customUniformDeclarations: "uniform vec4 testColor;",
        customUniformInfo: [{ name: "testColor", type: "vec4" }],
        customUniformValues: [{ name: "testColor", type: "vec4", value: [1, 1, 0, 1] }],
      },
      slang: {
        image: "float4 mainImage(float2 fragCoord) { return testColor; }",
        customUniformDeclarations: "uniform vec4 testColor;",
        customUniformInfo: [{ name: "testColor", type: "vec4" }],
        customUniformValues: [{ name: "testColor", type: "vec4", value: [1, 1, 0, 1] }],
      },
    },
  },
  {
    name: "renders and samples a buffer pass",
    expected: solid([255, 0, 255, 255]),
    programs: {
      glsl: {
        image: "void mainImage(out vec4 color, in vec2 fragCoord) { color = texture(iChannel0, fragCoord / iResolution.xy); }",
        buffers: {
          BufferA: "void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0, 0.0, 1.0, 1.0); }",
        },
        config: {
          version: "1",
          passes: {
            Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
            BufferA: { path: "buffer-a.glsl", resolution: { width: 2, height: 2 } },
          },
        },
      },
      slang: {
        image: "float4 mainImage(float2 fragCoord) { return sampleIChannel0(fragCoord / iResolution.xy); }",
        buffers: {
          BufferA: "float4 mainImage(float2 fragCoord) { return float4(1.0, 0.0, 1.0, 1.0); }",
        },
        config: {
          version: "1",
          passes: {
            Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
            BufferA: { path: "buffer-a.slang", resolution: { width: 2, height: 2 } },
          },
        },
      },
    },
  },
];

describe.each(["glsl", "slang"] as const)("%s canvas conformance", (language) => {
  for (const testCase of conformanceCases) {
    it(testCase.name, { timeout: 30_000 }, async () => {
      const harness = createShaderCanvasHarness(language);
      try {
        await harness.compile(testCase.programs[language]);
        expect(await harness.renderAndReadPixels()).toEqual(testCase.expected);
      } finally {
        harness.dispose();
      }
    });
  }

  it("updates iFrame between rendered frames", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness(language);
    const program: Record<ShaderLanguage, ShaderProgram> = {
      glsl: {
        image: `void mainImage(out vec4 color, in vec2 fragCoord) {
          color = iFrame == 0 ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 1.0, 0.0, 1.0);
        }`,
      },
      slang: {
        image: `float4 mainImage(float2 fragCoord) {
          return iFrame == 0 ? float4(1.0, 0.0, 0.0, 1.0) : float4(0.0, 1.0, 0.0, 1.0);
        }`,
      },
    };
    try {
      await harness.compile(program[language]);
      expect(await harness.renderAndReadPixels(0)).toEqual(solid([255, 0, 0, 255]));
      expect(await harness.renderAndReadPixels(16)).toEqual(solid([0, 255, 0, 255]));
    } finally {
      harness.dispose();
    }
  });
});

describe("Slang-only canvas conformance", () => {
  it("runs a native compute pass and samples its output", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness("slang");
    try {
      await harness.compile({
        image: "float4 mainImage(float2 fragCoord) { return sampleIChannel0(fragCoord / iResolution.xy); }",
        buffers: {
          ComputePattern: `[shader("compute")]
            [numthreads(1, 1, 1)]
            void fillCanvas(uint3 dispatchThreadID : SV_DispatchThreadID) {
              writeOutput(dispatchThreadID.xy, float4(0.0, 0.0, 1.0, 1.0));
            }`,
        },
        config: {
          version: "1",
          passes: {
            Image: { inputs: { iChannel0: { type: "buffer", source: "ComputePattern" } } },
            ComputePattern: {
              type: "compute",
              path: "compute-pattern.slang",
              entryPoint: "fillCanvas",
              resolution: { width: 2, height: 2 },
            },
          },
        },
      });
      expect(await harness.renderAndReadPixels()).toEqual(solid([0, 0, 255, 255]));
    } finally {
      harness.dispose();
    }
  });
});
