import { describe, expect, it } from "vitest";
import { VERTEX_PASS_PREFIX, type GeometryConfig, type ShaderConfig } from "@shader-studio/types";
import { PIXEL_INSPECTOR_REGION_SIZE } from "../../types/PixelRegion";
import {
  createShaderCanvasHarness,
  type Pixel,
  type ShaderLanguage,
  type ShaderProgram,
} from "./ShaderCanvasHarness";

const CANVAS_SIZE = 16;
const WHITE: Pixel = [255, 255, 255, 255];
const BLACK: Pixel = [0, 0, 0, 255];

const WHITE_IMAGE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0); }",
  slang: "float4 mainImage(float2 fragCoord) { return float4(1.0); }",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f { return vec4f(1.0); }",
};

function program(language: ShaderLanguage, vertex: string, geometry?: GeometryConfig): ShaderProgram {
  const config: ShaderConfig = {
    version: "1",
    passes: { Image: { vertex: `image.vert.${language}`, ...(geometry ? { geometry } : {}) } },
  };
  return {
    image: WHITE_IMAGE[language],
    buffers: { [`${VERTEX_PASS_PREFIX}Image`]: vertex },
    config,
  };
}

/** Pixel at canvas column x and row y (row 0 at the top). */
function pixelAt(region: Uint8ClampedArray, x: number, y: number): Pixel {
  // The readback region is centred on the canvas centre.
  const half = PIXEL_INSPECTOR_REGION_SIZE / 2;
  const column = x + half - CANVAS_SIZE / 2;
  const row = y + half - CANVAS_SIZE / 2;
  const offset = (row * PIXEL_INSPECTOR_REGION_SIZE + column) * 4;
  return [...region.slice(offset, offset + 4)] as Pixel;
}

async function render(language: ShaderLanguage, shader: ShaderProgram): Promise<Uint8ClampedArray> {
  const harness = createShaderCanvasHarness(language);
  try {
    harness.resize(CANVAS_SIZE, CANVAS_SIZE);
    await harness.compile(shader);
    return await harness.renderAndReadRegion();
  } finally {
    harness.dispose();
  }
}

// A triangle placed entirely by indexing a three-point array with vertexIndex.
const PROCEDURAL_TRIANGLE: Record<ShaderLanguage, string> = {
  glsl: `const vec2 points[3] = vec2[3](vec2(0.0, 0.5), vec2(-0.5, -0.5), vec2(0.5, -0.5));
void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  position = vec3(points[vertexIndex], 0.0);
}`,
  slang: `static const float2 points[3] = { float2(0.0, 0.5), float2(-0.5, -0.5), float2(0.5, -0.5) };
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  position = float3(points[vertexIndex], 0.0);
}`,
  wgsl: `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  var points = array<vec2f, 3>(vec2f(0.0, 0.5), vec2f(-0.5, -0.5), vec2f(0.5, -0.5));
  *position = vec3f(points[vertexIndex], 0.0);
}`,
};

/** Collapses every plane vertex the condition selects onto the origin. */
function collapsePlaneVertices(language: ShaderLanguage, condition: string): string {
  switch (language) {
    case "glsl":
      return `void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  if (${condition}) { position = vec3(0.0); }
}`;
    case "slang":
      return `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  if (${condition}) { position = float3(0.0); }
}`;
    case "wgsl":
      return `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  if (${condition}) { *position = vec3f(0.0); }
}`;
  }
}

const unsigned = (language: ShaderLanguage, value: number): string =>
  language === "glsl" ? `${value}` : `${value}u`;

describe.each(["glsl", "slang", "wgsl"] as const)("%s vertex geometry", (language) => {
  it("draws a triangle placed only from vertexIndex", { timeout: 30_000 }, async () => {
    const region = await render(language, program(language, PROCEDURAL_TRIANGLE[language]));

    // Inside: centre, and a lower-left point inside the left edge.
    expect(pixelAt(region, 8, 8)).toEqual(WHITE);
    expect(pixelAt(region, 5, 10)).toEqual(WHITE);
    // Outside: corners and the upper flanks of the apex are cleared to black.
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14], [3, 5], [12, 5]]) {
      expect(pixelAt(region, x, y), `pixel ${x},${y}`).toEqual(BLACK);
    }
  });

  it("passes the plane's mesh vertex indices to the hook", { timeout: 30_000 }, async () => {
    const plane: GeometryConfig = { type: "plane" };
    const untouched = `vertexIndex >= ${unsigned(language, 4)}`;
    const allButFirst = `vertexIndex != ${unsigned(language, 0)}`;

    // The plane has four vertices (0-3): no index reaches 4, so it renders...
    expect(pixelAt(await render(language, program(language, collapsePlaneVertices(language, untouched), plane)), 8, 8))
      .toEqual(WHITE);
    // ...and indices other than 0 exist: collapsing them degenerates both triangles.
    expect(pixelAt(await render(language, program(language, collapsePlaneVertices(language, allButFirst), plane)), 8, 8))
      .toEqual(BLACK);
  });
});
