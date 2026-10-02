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

/** A hook that sets position from `expression`, a vec2 over `vertexIndex` and `points`. */
function placeVertices(language: ShaderLanguage, points: readonly (readonly [number, number])[], expression: Record<ShaderLanguage, string>): string {
  const literal = (type: string) => points.map(([x, y]) => `${type}(${x.toFixed(4)}, ${y.toFixed(4)})`).join(", ");
  switch (language) {
    case "glsl":
      return `const vec2 points[${points.length}] = vec2[${points.length}](${literal("vec2")});
void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  position = vec3(${expression.glsl}, 0.0);
}`;
    case "slang":
      return `static const float2 points[${points.length}] = { ${literal("float2")} };
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  position = float3(${expression.slang}, 0.0);
}`;
    case "wgsl":
      return `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  var points = array<vec2f, ${points.length}>(${literal("vec2f")});
  *position = vec3f(${expression.wgsl}, 0.0);
}`;
  }
}

/** Clip-space centre of canvas pixel (x, y), row 0 at the top. */
const pixelCentre = (x: number, y: number): [number, number] =>
  [((x + 0.5) / CANVAS_SIZE) * 2 - 1, 1 - ((y + 0.5) / CANVAS_SIZE) * 2];

// Six hexagon corners ordered so consecutive triples tile it as a strip.
const HEXAGON_STRIP = [[0.25, 0.433], [-0.25, 0.433], [0.5, 0], [-0.5, 0], [0.25, -0.433], [-0.25, -0.433]] as const;

const HEXAGON_INSIDE = [[8, 8], [6, 9], [10, 6], [7, 5], [9, 10]] as const;
// Corners, beyond the flat top/bottom and sides, and inside the bounding box
// but past the slanted edges (a rectangle would cover these).
const HEXAGON_OUTSIDE = [[1, 1], [14, 14], [8, 2], [8, 13], [2, 8], [13, 8], [11, 5], [4, 10], [4, 5], [11, 10]] as const;

function expectHexagon(region: Uint8ClampedArray): void {
  for (const [x, y] of HEXAGON_INSIDE) {
    expect(pixelAt(region, x, y), `inside ${x},${y}`).toEqual(WHITE);
  }
  for (const [x, y] of HEXAGON_OUTSIDE) {
    expect(pixelAt(region, x, y), `outside ${x},${y}`).toEqual(BLACK);
  }
}

const POINT_PIXELS = [[4, 4], [11, 4], [4, 11], [11, 11]] as const;
const LINE_ROW = 8;

describe.each(["glsl", "slang", "wgsl"] as const)("%s fullscreen vertexCount and topology", (language) => {
  it("draws a hexagon as a 12-vertex triangle-list", { timeout: 30_000 }, async () => {
    // List vertex i takes strip corner i/3 + i%3: triangles (0,1,2), (1,2,3), (2,3,4), (3,4,5).
    const index = { glsl: "points[vertexIndex / 3 + vertexIndex % 3]", slang: "points[vertexIndex / 3u + vertexIndex % 3u]", wgsl: "points[vertexIndex / 3u + vertexIndex % 3u]" };
    const vertex = placeVertices(language, HEXAGON_STRIP, index);

    expectHexagon(await render(language, program(language, vertex, { type: "fullscreen", vertexCount: 12, topology: "triangle-list" })));
    // vertexCount alone keeps the default triangle-list topology.
    expectHexagon(await render(language, program(language, vertex, { type: "fullscreen", vertexCount: 12 })));
  });

  it("draws a hexagon as a 6-vertex triangle-strip", { timeout: 30_000 }, async () => {
    const vertex = placeVertices(language, HEXAGON_STRIP, { glsl: "points[vertexIndex]", slang: "points[vertexIndex]", wgsl: "points[vertexIndex]" });

    expectHexagon(await render(language, program(language, vertex, { type: "fullscreen", vertexCount: 6, topology: "triangle-strip" })));
  });

  it("draws a line-strip spaced by iVertexCount", { timeout: 30_000 }, async () => {
    // Five vertices from x = -0.75 to 0.75 (pixel columns 2 to 14) along one pixel row;
    // the spacing is only right if iVertexCount is 5.
    const [, rowY] = pixelCentre(0, LINE_ROW);
    const along = {
      glsl: `vec2(-0.75 + 1.5 * float(vertexIndex) / float(iVertexCount - 1), ${rowY.toFixed(4)})`,
      slang: `float2(-0.75 + 1.5 * float(vertexIndex) / float(iVertexCount - 1u), ${rowY.toFixed(4)})`,
      wgsl: `vec2f(-0.75 + 1.5 * f32(vertexIndex) / f32(iVertexCount - 1u), ${rowY.toFixed(4)})`,
    };
    const region = await render(language, program(language, placeVertices(language, [[0, 0]], along), { type: "fullscreen", vertexCount: 5, topology: "line-strip" }));

    for (let x = 4; x <= 12; x++) {
      expect(pixelAt(region, x, LINE_ROW), `on line ${x}`).toEqual(WHITE);
    }
    for (const [x, y] of [[0, LINE_ROW], [15, LINE_ROW], [8, LINE_ROW - 3], [8, LINE_ROW + 3], [1, 1], [14, 14]]) {
      expect(pixelAt(region, x, y), `off line ${x},${y}`).toEqual(BLACK);
    }
  });

  it("draws one pixel per vertex as a point-list", { timeout: 30_000 }, async () => {
    const points = POINT_PIXELS.map(([x, y]) => pixelCentre(x, y));
    const vertex = placeVertices(language, points, { glsl: "points[vertexIndex]", slang: "points[vertexIndex]", wgsl: "points[vertexIndex]" });
    const region = await render(language, program(language, vertex, { type: "fullscreen", vertexCount: 4, topology: "point-list" }));

    for (const [x, y] of POINT_PIXELS) {
      expect(pixelAt(region, x, y), `point ${x},${y}`).toEqual(WHITE);
    }
    // Points rasterise at 1px: neighbours and the centre stay clear.
    for (const [x, y] of [[8, 8], [5, 4], [4, 5], [3, 4], [10, 11], [11, 12]]) {
      expect(pixelAt(region, x, y), `clear ${x},${y}`).toEqual(BLACK);
    }
  });
});

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

  it("binds iVertexCount to the plane's mesh vertex count", { timeout: 30_000 }, async () => {
    const plane: GeometryConfig = { type: "plane" };
    // Every vertex collapses unless iVertexCount is the plane's four vertices.
    const wrongCount = `iVertexCount != ${unsigned(language, 4)}`;

    expect(pixelAt(await render(language, program(language, collapsePlaneVertices(language, wrongCount), plane)), 8, 8))
      .toEqual(WHITE);
  });
});
