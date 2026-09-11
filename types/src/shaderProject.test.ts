import { describe, expect, it } from "vitest";
import {
  configPathForShader,
  isCommonPassName,
  parseVertexPassKey,
  resolveConfiguredPath,
  resourcesForPass,
  shaderPathsForConfig,
  stageForPass,
  vertexPassKey,
  VERTEX_PASS_PREFIX,
  type ConfiguredPathHost,
} from "./shaderProject";
import type { ShaderConfig } from "./ShaderConfig";

const config = {
  version: "1.0",
  storage: { data: { count: 4, elementType: "float" } },
  passes: {
    Image: { path: "image.glsl", inputs: { back: { type: "texture" }, cube: { type: "cubemap" } } },
    Worker: { type: "compute", path: "worker.slang" },
    Vertex: { path: "vertex.vert" },
  },
} as unknown as ShaderConfig;

describe("configPathForShader", () => {
  it("maps every registered extension to its sibling config", () => {
    for (const path of ["a.glsl", "a.frag", "a.vert", "a.slang", "a.wgsl"]) {
      expect(configPathForShader(`/shaders/${path}`)).toBe("/shaders/a.sha.json");
    }
  });

  it("matches uppercase extensions and leaves unknown paths unchanged", () => {
    expect(configPathForShader("/shaders/a.SLANG")).toBe("/shaders/a.sha.json");
    expect(configPathForShader("/shaders/a.WGSL")).toBe("/shaders/a.sha.json");
    expect(configPathForShader("/shaders/a.sha.json")).toBe("/shaders/a.sha.json");
    expect(configPathForShader("/shaders/a.txt")).toBe("/shaders/a.txt");
    expect(configPathForShader("/shaders/a.comp-backup")).toBe("/shaders/a.comp-backup");
  });
});

describe("shaderPathsForConfig", () => {
  it("lists registry candidates with the canonical extension first", () => {
    const candidates = shaderPathsForConfig("/shaders/a.sha.json");
    expect(candidates[0]).toBe("/shaders/a.glsl");
    expect(candidates).toContain("/shaders/a.slang");
    expect(candidates).toContain("/shaders/a.wgsl");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("matches uppercase config suffixes and rejects non-configs", () => {
    expect(shaderPathsForConfig("/shaders/a.SHA.JSON")[0]).toBe("/shaders/a.glsl");
    expect(shaderPathsForConfig("/shaders/a.glsl")).toEqual([]);
  });
});

describe("vertex pass keys", () => {
  it("round-trips names and rejects other keys", () => {
    expect(VERTEX_PASS_PREFIX).toBe("__shader_studio_vertex__:");
    expect(vertexPassKey("Image")).toBe("__shader_studio_vertex__:Image");
    expect(parseVertexPassKey("__shader_studio_vertex__:Image")).toBe("Image");
    expect(parseVertexPassKey("Image")).toBeUndefined();
    expect(parseVertexPassKey("__shader_studio_vertex__")).toBeUndefined();
  });
});

describe("isCommonPassName", () => {
  it("accepts only lowercase common", () => {
    expect(isCommonPassName("common")).toBe(true);
    expect(isCommonPassName("Common")).toBe(false);
    expect(isCommonPassName("COMMON")).toBe(false);
    expect(isCommonPassName("Image")).toBe(false);
  });
});

describe("stageForPass", () => {
  it("derives compute, fragment and missing passes", () => {
    expect(stageForPass(config, "Worker", "/shaders/worker.slang")).toBe("compute");
    expect(stageForPass(config, "Image", "/shaders/image.glsl")).toBe("fragment");
    expect(stageForPass(config, "Missing", "/shaders/missing.glsl")).toBe("fragment");
    expect(stageForPass(null, "Image", "/shaders/image.glsl")).toBe("fragment");
  });

  it("prefers the vertex filename rule over the pass entry", () => {
    expect(stageForPass(config, "Vertex", "/shaders/vertex.vert")).toBe("vertex");
    expect(stageForPass(config, "Image", "/shaders/image.vert")).toBe("vertex");
    expect(stageForPass(config, "Image", "/shaders/image.VERT")).toBe("vertex");
    expect(stageForPass(config, "Image", "/shaders/image.vs")).toBe("vertex");
  });
});

describe("resourcesForPass", () => {
  it("lists texture inputs by slot then storage", () => {
    expect(resourcesForPass(config, "Image")).toEqual([
      { name: "back", kind: "texture-2d", slot: 0 },
      { name: "cube", kind: "texture-cube", slot: 1 },
      { name: "data", kind: "storage", elementType: "float" },
    ]);
  });

  it("handles passes without inputs and unknown passes", () => {
    expect(resourcesForPass(config, "Worker")).toEqual([
      { name: "data", kind: "storage", elementType: "float" },
    ]);
    expect(resourcesForPass(null, "Image")).toEqual([]);
  });
});

describe("resolveConfiguredPath", () => {
  const posix: ConfiguredPathHost = {
    workspaceRootFor: (anchor) => anchor.startsWith("/ws/") ? "/ws" : undefined,
    joinPath: (base, ...segments) => [base, ...segments].join("/"),
    dirnameOf: (path) => path.slice(0, path.lastIndexOf("/")),
    normalizePath: (path) => path.replace(/\/\.(?=\/|$)/g, "").replace(/[^/]+\/\.\.\//g, ""),
    isAbsolutePath: (path) => path.startsWith("/"),
  };

  it("resolves @/ against the workspace root containing the config", () => {
    expect(resolveConfiguredPath(posix, "/ws/shaders/a.sha.json", "@/shared/x.glsl"))
      .toBe("/ws/shared/x.glsl");
  });

  it("falls back to the config directory when there is no workspace root", () => {
    expect(resolveConfiguredPath(posix, "/elsewhere/a.sha.json", "@/shared/x.glsl"))
      .toBe("/elsewhere/shared/x.glsl");
  });

  it("normalizes absolute paths", () => {
    expect(resolveConfiguredPath(posix, "/ws/shaders/a.sha.json", "/abs/./x.glsl"))
      .toBe("/abs/x.glsl");
  });

  it("resolves relatives against the config directory, never the shader's", () => {
    expect(resolveConfiguredPath(posix, "/ws/configs/a.sha.json", "x.glsl"))
      .toBe("/ws/configs/x.glsl");
    expect(resolveConfiguredPath(posix, "/ws/configs/a.sha.json", "../shared/x.glsl"))
      .toBe("/ws/shared/x.glsl");
  });
});
