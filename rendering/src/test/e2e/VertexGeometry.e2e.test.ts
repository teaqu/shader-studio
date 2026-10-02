import { describe, expect, it } from "vitest";
import { VERTEX_PASS_PREFIX, type GeometryConfig, type RenderPassSettings, type ShaderConfig } from "@shader-studio/types";
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

const FRONT_FACING_IMAGE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 color, in vec2 coord) { color = iFrontFacing ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0); }",
  slang: "float4 mainImage(float2 coord) { return iFrontFacing ? float4(0, 1, 0, 1) : float4(1, 0, 0, 1); }",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f { return select(vec4f(1.0, 0.0, 0.0, 1.0), vec4f(0.0, 1.0, 0.0, 1.0), iFrontFacing); }",
};

function program(
  language: ShaderLanguage,
  vertex: string | undefined,
  geometry?: GeometryConfig,
  settings: RenderPassSettings = {},
  image: string = WHITE_IMAGE[language],
): ShaderProgram {
  const config: ShaderConfig = {
    version: "1",
    passes: { Image: { ...(vertex ? { vertex: `image.vert.${language}` } : {}), ...(geometry ? { geometry } : {}), ...settings } },
  };
  return {
    image,
    buffers: vertex ? { [`${VERTEX_PASS_PREFIX}Image`]: vertex } : {},
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
const UV_TRIANGLES = [[-0.9, -0.6], [-0.1, -0.6], [-0.5, 0.6], [0.1, -0.6], [0.9, -0.6], [0.5, 0.6]] as const;

function placeUvTriangles(language: ShaderLanguage): string {
  const literal = (type: string) => UV_TRIANGLES.map(([x, y]) => `${type}(${x}, ${y})`).join(", ");
  switch (language) {
    case "glsl":
      return `const vec2 points[6] = vec2[6](${literal("vec2")});
void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  position = vec3(points[vertexIndex], 0.0);
  uv = vec2(float(vertexIndex / 3), 0.0);
}`;
    case "slang":
      return `static const float2 points[6] = { ${literal("float2")} };
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  position = float3(points[vertexIndex], 0.0);
  uv = float2(float(vertexIndex / 3u), 0.0);
}`;
    case "wgsl":
      return `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  var points = array<vec2f, 6>(${literal("vec2f")});
  *position = vec3f(points[vertexIndex], 0.0);
  *uv = vec2f(f32(vertexIndex / 3u), 0.0);
}`;
  }
}

const UV_COLOUR_IMAGE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 color, in vec2 coord) { color = iVertexUv.x > 0.5 ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0); }",
  slang: "float4 mainImage(float2 coord) { return iVertexUv.x > 0.5 ? float4(0, 1, 0, 1) : float4(1, 0, 0, 1); }",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f { return select(vec4f(1.0, 0.0, 0.0, 1.0), vec4f(0.0, 1.0, 0.0, 1.0), iVertexUv.x > 0.5); }",
};

describe.each(["glsl", "slang", "wgsl"] as const)("%s clip-space vertices", (language) => {
  it("passes each shape's interpolated uv to mainImage as iVertexUv", { timeout: 30_000 }, async () => {
    const shader = program(
      language,
      placeUvTriangles(language),
      { type: "vertices", vertexCount: 6, topology: "triangle-list", space: "clip" },
      {},
      UV_COLOUR_IMAGE[language],
    );
    const region = await render(language, shader);

    expect(pixelAt(region, 4, 8)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(region, 11, 8)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(region, 8, 1)).toEqual(BLACK);
  });

  it("draws a hexagon as a 12-vertex triangle-list", { timeout: 30_000 }, async () => {
    // List vertex i takes strip corner i/3 + i%3: triangles (0,1,2), (1,2,3), (2,3,4), (3,4,5).
    const index = { glsl: "points[vertexIndex / 3 + vertexIndex % 3]", slang: "points[vertexIndex / 3u + vertexIndex % 3u]", wgsl: "points[vertexIndex / 3u + vertexIndex % 3u]" };
    const vertex = placeVertices(language, HEXAGON_STRIP, index);

    expectHexagon(await render(language, program(language, vertex, { type: "vertices", vertexCount: 12, topology: "triangle-list", space: "clip" })));
    // vertexCount alone keeps the default triangle-list topology.
    expectHexagon(await render(language, program(language, vertex, { type: "vertices", vertexCount: 12, space: "clip" })));
  });

  it("draws a hexagon as a 6-vertex triangle-strip", { timeout: 30_000 }, async () => {
    const vertex = placeVertices(language, HEXAGON_STRIP, { glsl: "points[vertexIndex]", slang: "points[vertexIndex]", wgsl: "points[vertexIndex]" });

    expectHexagon(await render(language, program(language, vertex, { type: "vertices", vertexCount: 6, topology: "triangle-strip", space: "clip" })));
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
    const region = await render(language, program(language, placeVertices(language, [[0, 0]], along), { type: "vertices", vertexCount: 5, topology: "line-strip", space: "clip" }));

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
    const region = await render(language, program(language, vertex, { type: "vertices", vertexCount: 4, topology: "point-list", space: "clip" }));

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

describe.each(["glsl", "slang", "wgsl"] as const)("%s fullscreen stays one three-vertex triangle", (language) => {
  it("binds iVertexCount to 3 and covers every pixel without a hook", { timeout: 30_000 }, async () => {
    // The hook collapses the triangle unless iVertexCount is 3.
    const keepIfThree = {
      glsl: `void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  if (iVertexCount != 3) { position = vec3(0.0); }
}`,
      slang: `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  if (iVertexCount != 3u) { position = float3(0.0); }
}`,
      wgsl: `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  if (iVertexCount != 3u) { *position = vec3f(0.0); }
}`,
    };
    const hooked = await render(language, program(language, keepIfThree[language], { type: "fullscreen" }));
    const plain = await render(language, program(language, undefined));

    for (const region of [hooked, plain]) {
      for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15], [8, 8]]) {
        expect(pixelAt(region, x, y), `pixel ${x},${y}`).toEqual(WHITE);
      }
    }
  });
});

type Vec3 = [number, number, number];

/** The orbit camera's default eye, looking at the origin (see OrbitCamera). */
const CAMERA_EYE: Vec3 = [4 * Math.SQRT1_2, 1.5, 4 * Math.SQRT1_2];
const normalize = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
};
const cross = ([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 => [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
const FORWARD = normalize([-CAMERA_EYE[0], -CAMERA_EYE[1], -CAMERA_EYE[2]]);
const SCREEN_RIGHT = normalize(cross(FORWARD, [0, 1, 0]));
const SCREEN_UP = cross(SCREEN_RIGHT, FORWARD);

/** World point at screen-plane offset (right, up) and `depth` along the view direction from the origin. */
const worldPoint = (right: number, up: number, depth = 0): Vec3 => [0, 1, 2].map((axis) =>
  SCREEN_RIGHT[axis] * right + SCREEN_UP[axis] * up + FORWARD[axis] * depth) as Vec3;

/**
 * A hook that places vertex i at points[i] and tags each triangle in uv.x
 * (0 for the first, 1 for the second, ...), so world-space mainImage, which
 * receives uv * iResolution, can tell triangles apart.
 */
function placePoints3(language: ShaderLanguage, points: readonly Vec3[]): string {
  const literal = (type: string) => points.map((point) => `${type}(${point.map((value) => value.toFixed(4)).join(", ")})`).join(", ");
  switch (language) {
    case "glsl":
      return `const vec3 points[${points.length}] = vec3[${points.length}](${literal("vec3")});
void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {
  position = points[vertexIndex];
  uv = vec2(float(vertexIndex / 3), 0.0);
}`;
    case "slang":
      return `static const float3 points[${points.length}] = { ${literal("float3")} };
void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {
  position = points[vertexIndex];
  uv = float2(float(vertexIndex / 3u), 0.0);
}`;
    case "wgsl":
      return `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  var points = array<vec3f, ${points.length}>(${literal("vec3f")});
  *position = points[vertexIndex];
  *uv = vec2f(f32(vertexIndex / 3u), 0.0);
}`;
  }
}

const RED: Pixel = [255, 0, 0, 255];
const GREEN: Pixel = [0, 255, 0, 255];

/** World space: red for the first triangle, green for the second (from the uv tag). */
const TRIANGLE_COLOUR_IMAGE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 color, in vec2 coord) { color = coord.x > 0.5 * iResolution.x ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0); }",
  slang: "float4 mainImage(float2 coord) { return coord.x > 0.5 * iResolution.x ? float4(0, 1, 0, 1) : float4(1, 0, 0, 1); }",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f { return select(vec4f(1.0, 0.0, 0.0, 1.0), vec4f(0.0, 1.0, 0.0, 1.0), coord.x > 0.5 * iResolution.x); }",
};

/** Green where the surface faces the camera, red where it faces away. */
const FACING_IMAGE: Record<ShaderLanguage, string> = {
  glsl: "void mainImage(out vec4 color, in vec2 coord) { color = dot(iNormal, iCameraPosition - iWorldPosition) > 0.0 ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0); }",
  slang: "float4 mainImage(float2 coord) { return dot(iNormal, iCameraPosition - iWorldPosition) > 0.0 ? float4(0, 1, 0, 1) : float4(1, 0, 0, 1); }",
  wgsl: "fn mainImage(coord: vec2f) -> vec4f { return select(vec4f(1.0, 0.0, 0.0, 1.0), vec4f(0.0, 1.0, 0.0, 1.0), dot(iNormal, iCameraPosition - iWorldPosition) > 0.0); }",
};

/** A flat grey with the given alpha. */
function greyImage(language: ShaderLanguage, value: number, alpha: number): string {
  const v = value.toFixed(3);
  const a = alpha.toFixed(3);
  switch (language) {
    case "glsl":
      return `void mainImage(out vec4 color, in vec2 coord) { color = vec4(${v}, ${v}, ${v}, ${a}); }`;
    case "slang":
      return `float4 mainImage(float2 coord) { return float4(${v}, ${v}, ${v}, ${a}); }`;
    case "wgsl":
      return `fn mainImage(coord: vec2f) -> vec4f { return vec4f(${v}, ${v}, ${v}, ${a}); }`;
  }
}

/** Expects an RGB grey within 2 of `value` (8-bit), ignoring alpha. */
function expectGrey(pixel: Pixel, value: number, label: string): void {
  for (const channel of pixel.slice(0, 3)) {
    expect(Math.abs(channel - value), `${label}: ${pixel.join(",")} vs ${value}`).toBeLessThanOrEqual(2);
  }
}

/** Two triangles forming the axis-aligned rectangle [x0, x1] x [y0, y1] at depth z, counter-clockwise. */
function rectangle(x0: number, y0: number, x1: number, y1: number, z = 0): Vec3[] {
  return [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y0, z], [x1, y1, z], [x0, y1, z]];
}

describe.each(["glsl", "slang", "wgsl"] as const)("%s world-space vertices", (language) => {
  it("draws an object-space square at the centre with the default orbit camera", { timeout: 30_000 }, async () => {
    const square = [
      worldPoint(-0.4, -0.4), worldPoint(0.4, -0.4), worldPoint(0.4, 0.4),
      worldPoint(-0.4, -0.4), worldPoint(0.4, 0.4), worldPoint(-0.4, 0.4),
    ];
    // World space is the default space.
    const region = await render(language, program(language, placePoints3(language, square), { type: "vertices", vertexCount: 6 }));

    for (const [x, y] of [[8, 8], [7, 7], [9, 9]]) {
      expect(pixelAt(region, x, y), `inside ${x},${y}`).toEqual(WHITE);
    }
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15], [8, 1], [1, 8]]) {
      expect(pixelAt(region, x, y), `outside ${x},${y}`).toEqual(BLACK);
    }
  });

  it("ignores the camera in clip space: the same points land at clip coordinates", { timeout: 30_000 }, async () => {
    // A world-space point far off to the side; in clip space (0.9, 0.9) is the top-right corner.
    const points = rectangle(0.5, 0.5, 1, 1);
    const region = await render(language, program(language, placePoints3(language, points), { type: "vertices", vertexCount: 6, space: "clip" }));

    expect(pixelAt(region, 14, 1)).toEqual(WHITE);
    expect(pixelAt(region, 8, 8)).toEqual(BLACK);
    expect(pixelAt(region, 1, 14)).toEqual(BLACK);
  });
});

/** A near (first, red) and a far (second, green) triangle that both cover the centre. */
function nearThenFar(): Vec3[] {
  const triangle = (depth: number) => [worldPoint(-1.5, -1.5, depth), worldPoint(1.5, -1.5, depth), worldPoint(0, 1.5, depth)];
  return [...triangle(-0.5), ...triangle(0.5)];
}

function farThenNear(): Vec3[] {
  const points = nearThenFar();
  return [...points.slice(3), ...points.slice(0, 3)];
}

describe.each(["glsl", "slang", "wgsl"] as const)("%s depth settings", (language) => {
  const draw = (points: Vec3[], settings: RenderPassSettings = {}, space: "world" | "clip" = "world") =>
    render(language, program(language, placePoints3(language, points), { type: "vertices", vertexCount: points.length, space }, settings, TRIANGLE_COLOUR_IMAGE[language]));

  it("hides the far triangle behind the near one by default, whichever is drawn first", { timeout: 30_000 }, async () => {
    expect(pixelAt(await draw(nearThenFar()), 8, 8)).toEqual(RED);
    // Far first: the second triangle (green tag) is now the near one.
    expect(pixelAt(await draw(farThenNear()), 8, 8)).toEqual(GREEN);
  });

  it("lets the later far triangle through when depth writes are off", { timeout: 30_000 }, async () => {
    expect(pixelAt(await draw(nearThenFar(), { depth: { write: false } }), 8, 8)).toEqual(GREEN);
  });

  it("keeps the far triangle with compare greater", { timeout: 30_000 }, async () => {
    expect(pixelAt(await draw(nearThenFar(), { depth: { compare: "greater" } }), 8, 8)).toEqual(GREEN);
    expect(pixelAt(await draw(farThenNear(), { depth: { compare: "greater" } }), 8, 8)).toEqual(RED);
  });

  it("draws overlapping clip-space shapes in submission order by default, even when the later one is farther", { timeout: 30_000 }, async () => {
    // Additive 0.4 greys: where the far, later rectangle overlaps the near one
    // it still adds (0.8) unless the depth test is turned on (0.4).
    // Clip z in [0, 1] is inside both WebGL's [-1, 1] and WebGPU's [0, 1] range.
    const near = rectangle(-0.75, -0.5, 0.25, 0.5, 0.25);
    const far = rectangle(-0.25, -0.5, 0.75, 0.5, 0.75);
    const image = greyImage(language, 0.4, 1);
    const clip = (settings: RenderPassSettings) =>
      render(language, program(language, placePoints3(language, [...near, ...far]), { type: "vertices", vertexCount: 12, space: "clip" }, { blend: "additive", ...settings }, image));

    const byDefault = await clip({});
    expectGrey(pixelAt(byDefault, 8, 8), 204, "overlap, default");
    expectGrey(pixelAt(byDefault, 3, 8), 102, "near only");
    expectGrey(pixelAt(byDefault, 12, 8), 102, "far only");

    const tested = await clip({ depth: { test: true } });
    expectGrey(pixelAt(tested, 8, 8), 102, "overlap, depth test on");
    expectGrey(pixelAt(tested, 12, 8), 102, "far only, depth test on");
  });
});

describe.each(["glsl", "slang", "wgsl"] as const)("%s blending", (language) => {
  // Left rectangle covers columns 2-9, right covers 6-13; 6-9 overlap.
  const left = rectangle(-0.75, -0.5, 0.25, 0.5);
  const right = rectangle(-0.25, -0.5, 0.75, 0.5);
  const draw = (blend: RenderPassSettings["blend"], image: string) =>
    render(language, program(language, placePoints3(language, [...left, ...right]), { type: "vertices", vertexCount: 12, space: "clip" }, blend ? { blend } : {}, image));
  const expectBands = (region: Uint8ClampedArray, single: number, overlap: number) => {
    expectGrey(pixelAt(region, 3, 8), single, "left only");
    expectGrey(pixelAt(region, 8, 8), overlap, "overlap");
    expectGrey(pixelAt(region, 12, 8), single, "right only");
    expectGrey(pixelAt(region, 8, 1), 0, "outside");
  };

  it("sums overlapping shapes with additive blending", { timeout: 30_000 }, async () => {
    expectBands(await draw("additive", greyImage(language, 0.4, 1)), 102, 204);
  });

  it("composites with alpha and premultiplied blending", { timeout: 30_000 }, async () => {
    // 1 at alpha 0.5 over black is 0.5; a second layer gives 0.5 + 0.5 * 0.5.
    expectBands(await draw("alpha", greyImage(language, 1, 0.5)), 128, 191);
    expectBands(await draw("premultiplied", greyImage(language, 0.5, 0.5)), 128, 191);
  });

  it("overwrites with blend none, the default", { timeout: 30_000 }, async () => {
    expectBands(await draw("none", greyImage(language, 0.4, 1)), 102, 102);
    expectBands(await draw(undefined, greyImage(language, 0.4, 1)), 102, 102);
  });

  it("blends a fullscreen pass over the cleared target", { timeout: 30_000 }, async () => {
    const image = greyImage(language, 1, 0.5);
    expectGrey(pixelAt(await render(language, program(language, undefined, undefined, { blend: "alpha" }, image)), 8, 8), 128, "alpha");
    expectGrey(pixelAt(await render(language, program(language, undefined, undefined, {}, image)), 8, 8), 255, "none");
  });
});

/** A counter-clockwise triangle on the left half and a clockwise one on the right, as seen on screen. */
function windingPair(place: (x: number, y: number) => Vec3): Vec3[] {
  return [
    place(-0.9, -0.5), place(-0.1, -0.5), place(-0.5, 0.5),
    place(0.1, -0.5), place(0.5, 0.5), place(0.9, -0.5),
  ];
}

describe.each(["glsl", "slang", "wgsl"] as const)("%s back-face culling", (language) => {
  const spaces = {
    clip: (x: number, y: number): Vec3 => [x, y, 0],
    // Scaled so the pair spans the same part of the screen as in clip space.
    world: (x: number, y: number): Vec3 => worldPoint(x * 1.6, y * 1.6),
  };

  it("exposes primitive orientation as iFrontFacing", { timeout: 30_000 }, async () => {
    const region = await render(language, program(
      language,
      placePoints3(language, windingPair(spaces.clip)),
      { type: "vertices", vertexCount: 6, space: "clip" },
      {},
      FRONT_FACING_IMAGE[language],
    ));

    expect(pixelAt(region, 4, 8), "counter-clockwise").toEqual([0, 255, 0, 255]);
    expect(pixelAt(region, 11, 8), "clockwise").toEqual([255, 0, 0, 255]);
  });

  it("defines fullscreen fragments as front-facing", { timeout: 30_000 }, async () => {
    expect(pixelAt(await render(language, program(language, undefined, undefined, {}, FRONT_FACING_IMAGE[language])), 8, 8))
      .toEqual([0, 255, 0, 255]);
  });

  it.each(["clip", "world"] as const)("keeps only the counter-clockwise triangle with cull back in %s space", { timeout: 30_000 }, async (space) => {
    const draw = (cull?: RenderPassSettings["cull"]) => render(language, program(
      language,
      placePoints3(language, windingPair(spaces[space])),
      { type: "vertices", vertexCount: 6, space },
      cull ? { cull } : {},
    ));
    const left: [number, number] = [4, 8];
    const right: [number, number] = [11, 8];

    const back = await draw("back");
    expect(pixelAt(back, ...left), "ccw with back").toEqual(WHITE);
    expect(pixelAt(back, ...right), "cw with back").toEqual(BLACK);

    const front = await draw("front");
    expect(pixelAt(front, ...left), "ccw with front").toEqual(BLACK);
    expect(pixelAt(front, ...right), "cw with front").toEqual(WHITE);

    const none = await draw();
    expect(pixelAt(none, ...left), "ccw with none").toEqual(WHITE);
    expect(pixelAt(none, ...right), "cw with none").toEqual(WHITE);
  });

  it("shows a cube's inside with cull front", { timeout: 30_000 }, async () => {
    const cube = (cull?: RenderPassSettings["cull"]) =>
      render(language, program(language, undefined, { type: "cube" }, cull ? { cull } : {}, FACING_IMAGE[language]));

    expect(pixelAt(await cube(), 8, 8), "default").toEqual(GREEN);
    expect(pixelAt(await cube("back"), 8, 8), "back").toEqual(GREEN);
    expect(pixelAt(await cube("front"), 8, 8), "front").toEqual(RED);
  });
});

describe.each(["glsl", "slang", "wgsl"] as const)("%s blending into a float buffer pass", (language) => {
  // Image shows half the buffer, so values above 1 that the float buffer
  // keeps become visible instead of clamping.
  const HALF_OF_BUFFER: Record<ShaderLanguage, string> = {
    glsl: "void mainImage(out vec4 color, in vec2 coord) { color = vec4(texture(iChannel0, coord / iResolution.xy).rgb * 0.5, 1.0); }",
    slang: "float4 mainImage(float2 coord) { return float4(sample2D(iChannel0.texture, iChannel0.sampler, coord / iResolution.xy).rgb * 0.5, 1.0); }",
    wgsl: "fn mainImage(coord: vec2f) -> vec4f { return vec4f(sample2D(iChannel0Texture, iChannel0Sampler, coord / iResolution.xy).rgb * 0.5, 1.0); }",
  };

  it.each([undefined, "rgba32float", "rgba16float"] as const)(
    "sums overlapping shapes past 1.0 with additive blending (outputFormat %s)",
    { timeout: 30_000 },
    async (outputFormat) => {
      // Two overlapping 0.75 greys: 0.75 alone and 1.5 where they overlap, halved by Image.
      const left = rectangle(-0.75, -0.5, 0.25, 0.5);
      const right = rectangle(-0.25, -0.5, 0.75, 0.5);
      const shader: ShaderProgram = {
        image: HALF_OF_BUFFER[language],
        buffers: {
          BufferA: greyImage(language, 0.75, 1),
          [`${VERTEX_PASS_PREFIX}BufferA`]: placePoints3(language, [...left, ...right]),
        },
        config: {
          version: "1",
          passes: {
            BufferA: {
              path: `buffer-a.${language}`,
              vertex: `buffer-a.vert.${language}`,
              geometry: { type: "vertices", vertexCount: 12, space: "clip" },
              blend: "additive",
              ...(outputFormat ? { outputFormat } : {}),
            },
            Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA", filter: "nearest" } } },
          },
        },
      };
      const region = await render(language, shader);

      expectGrey(pixelAt(region, 3, 8), 96, "left only");
      expectGrey(pixelAt(region, 8, 8), 191, "overlap above 1.0");
      expectGrey(pixelAt(region, 12, 8), 96, "right only");
      expectGrey(pixelAt(region, 8, 1), 0, "outside");
    },
  );
});
