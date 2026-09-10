import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WGSL_ENABLE_TO_GPU_FEATURE,
  WGSL_KNOWN_GPU_FEATURES,
  extractWgslDirectives,
  wrapWgslComputeSource,
  wrapWgslImageSource,
  wgslUnsupportedFeatureMessage,
} from "../../webgpu/WgslPrelude";
import { allowNonUniformDerivatives } from "../../webgpu/wgslDiagnostics";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

const IMAGE = "fn mainImage(coord: vec2<f32>) -> vec4<f32> { return vec4<f32>(iTime); }";

function mainImageLine(source: string): number {
  const index = source.split("\n").findIndex((line) => line.includes("fn mainImage"));
  if (index === -1) {
    throw new Error("mainImage not found in assembled module");
  }
  return index + 1;
}

describe("wgsl directive hoisting", () => {
  it("hoists enable above the prelude and preserves user line numbers", () => {
    const userSource = `enable f16;\n${IMAGE}\nfn helper() -> f32 { return 1.0; }`;
    const { source, preludeLineCount, requiredFeatures } = wrapWgslImageSource(userSource);
    const enableLine = source.split("\n").findIndex((line) => line.includes("enable f16;")) + 1;
    const preludeLine = source.split("\n").findIndex((line) => line.includes("struct _ss_ShaderToyUniforms")) + 1;
    expect(enableLine).toBeGreaterThan(0);
    expect(enableLine).toBeLessThan(preludeLine);
    // User line 2 (mainImage) still maps through the offset.
    expect(mainImageLine(source) - preludeLineCount).toBe(2);
    expect(requiredFeatures).toEqual(["f16"]);
  });

  it("does not hoist a directive inside a comment or a string", () => {
    const userSource = `// enable f16;\n/* requires extra; */\nfn s() -> f32 { return 0.0; }\n${IMAGE}`;
    const { source, requiredFeatures } = wrapWgslImageSource(userSource);
    expect(source).toContain("// enable f16;");
    expect(source).toContain("/* requires extra; */");
    expect(requiredFeatures).toEqual([]);
    // No directive line was emitted above the prelude.
    const firstDirective = source.split("\n").findIndex((line) => /^\s*(enable|requires)\s/.test(line));
    expect(firstDirective).toBe(-1);
  });

  it("does not hoist directive-looking text inside a string literal", () => {
    const extracted = extractWgslDirectives("const text = \"enable f16;\";\n" + IMAGE);
    expect(extracted.directives).toEqual([]);
    expect(extracted.enableNames).toEqual([]);
    expect(extracted.stripped).toContain("\"enable f16;\"");
  });

  it("leaves a function-body diagnostic in place", () => {
    const userSource = `fn helper() -> f32 {\n  diagnostic(off, derivative_uniformity);\n  return 1.0;\n}\n${IMAGE}`;
    const { source, requiredFeatures } = wrapWgslImageSource(userSource);
    expect(source).toContain("diagnostic(off, derivative_uniformity);");
    expect(requiredFeatures).toEqual([]);
    // Still nested in the function body, not hoisted to the top.
    const lines = source.split("\n");
    const diagnosticLine = lines.findIndex((line) => line.includes("diagnostic(off, derivative_uniformity);")) + 1;
    expect(diagnosticLine).toBeGreaterThan(lines.findIndex((line) => line.includes("struct _ss_ShaderToyUniforms")) + 1);
  });

  it("deduplicates repeated enable directives", () => {
    const userSource = `enable f16;\nenable f16;\n${IMAGE}`;
    const { source, requiredFeatures } = wrapWgslImageSource(userSource);
    const count = source.split("\n").filter((line) => line.includes("enable f16;")).length;
    expect(count).toBe(1);
    expect(requiredFeatures).toEqual(["f16"]);
  });

  it("hoists requires and module-scope diagnostic directives", () => {
    const userSource = `requires readonly_and_readwrite_storage_textures;\ndiagnostic(off, derivative_uniformity);\n${IMAGE}`;
    const { source } = wrapWgslImageSource(userSource);
    const lines = source.split("\n");
    const requiresLine = lines.findIndex((line) => line.includes("requires readonly_and_readwrite_storage_textures;")) + 1;
    const diagnosticLine = lines.findIndex((line) => line.includes("diagnostic(off, derivative_uniformity);")) + 1;
    const preludeLine = lines.findIndex((line) => line.includes("struct _ss_ShaderToyUniforms")) + 1;
    expect(requiresLine).toBeGreaterThan(0);
    expect(diagnosticLine).toBeGreaterThan(0);
    expect(requiresLine).toBeLessThan(preludeLine);
    expect(diagnosticLine).toBeLessThan(preludeLine);
    expect(mainImageLine(source) - wrapWgslImageSource(userSource).preludeLineCount).toBe(3);
  });

  it("hoists directives out of common code too", () => {
    const { source, requiredFeatures } = wrapWgslImageSource(IMAGE, {
      commonCode: "enable f16;\nfn helper() -> f32 { return 1.0; }",
    });
    const lines = source.split("\n");
    expect(lines.findIndex((line) => line.includes("enable f16;")) + 1)
      .toBeLessThan(lines.findIndex((line) => line.includes("struct _ss_ShaderToyUniforms")) + 1);
    expect(requiredFeatures).toEqual(["f16"]);
  });

  it("hoists directives for compute passes", () => {
    const compute = "enable f16;\n@compute @workgroup_size(8, 8, 1)\nfn mainCompute(@builtin(global_invocation_id) id: vec3<u32>) {}";
    const { source, requiredFeatures } = wrapWgslComputeSource(compute, {
      workgroupSize: [8, 8, 1],
      outputLayers: 1,
      hasOutput: false,
    });
    const lines = source.split("\n");
    expect(lines.findIndex((line) => line.includes("enable f16;")) + 1)
      .toBeLessThan(lines.findIndex((line) => line.includes("struct _ss_ShaderToyUniforms")) + 1);
    expect(requiredFeatures).toEqual(["f16"]);
  });

  it("keeps the derivative-uniformity filter legal after hoisted directives", () => {
    const { source } = wrapWgslImageSource(`enable f16;\n${IMAGE}`);
    const filtered = allowNonUniformDerivatives(source);
    const lines = filtered.split("\n");
    const filterLine = lines.findIndex((line) => line.includes("diagnostic(off, derivative_uniformity);")) + 1;
    // Filter goes at the very top; directives may follow in any order before declarations.
    expect(filterLine).toBe(1);
    expect(lines.findIndex((line) => line.includes("enable f16;")) + 1).toBeGreaterThan(0);
    expect(lines.findIndex((line) => line.includes("struct _ss_ShaderToyUniforms")) + 1).toBeGreaterThan(filterLine);
  });
});

describe("wgsl feature negotiation", () => {
  it("maps known enable names to GPU features; core extensions map to nothing", () => {
    expect(WGSL_ENABLE_TO_GPU_FEATURE["f16"]).toBe("shader-f16");
    expect(WGSL_ENABLE_TO_GPU_FEATURE["dual_source_blending"]).toBe("dual-source-blending");
    expect(WGSL_ENABLE_TO_GPU_FEATURE["clip_distances"]).toBe("clip-distances");
    expect(WGSL_ENABLE_TO_GPU_FEATURE["subgroups"]).toBe("subgroups");
    expect(WGSL_ENABLE_TO_GPU_FEATURE["pointer_composite_access"]).toBeUndefined();
    expect(WGSL_KNOWN_GPU_FEATURES).toContain("float32-filterable");
    expect(WGSL_KNOWN_GPU_FEATURES).toContain("shader-f16");
  });

  it("produces a friendly error when the GPU lacks a required feature", () => {
    const message = wgslUnsupportedFeatureMessage(["f16"], () => false);
    expect(message).toMatch(/requires f16/);
    expect(message).toMatch(/does not support/);
  });

  it("reports no error when the feature is supported or is core WGSL", () => {
    expect(wgslUnsupportedFeatureMessage(["f16"], (feature) => feature === "shader-f16")).toBeUndefined();
    expect(wgslUnsupportedFeatureMessage(["pointer_composite_access"], () => false)).toBeUndefined();
    expect(wgslUnsupportedFeatureMessage([], () => false)).toBeUndefined();
  });

  it("requests the adapter-supported feature intersection at device creation", async () => {
    const context = { configure: vi.fn() };
    const device = {
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeTexture: vi.fn() },
      limits: {},
    };
    const adapter = {
      features: new Set(["shader-f16"]),
      limits: {},
      requestDevice: vi.fn(async () => device),
    };
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
      },
    });
    vi.spyOn(engine as unknown as { createCompiler(): Promise<unknown> }, "createCompiler")
      .mockResolvedValue({ compile: vi.fn(), dispose: vi.fn() });
    try {
      engine.initialize({
        width: 800,
        height: 600,
        getContext: vi.fn(() => context),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLCanvasElement);
      await (engine as unknown as { ready: Promise<void> }).ready;
      expect(adapter.requestDevice).toHaveBeenCalledWith({ requiredFeatures: ["shader-f16"] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits unsupported WGSL features from the device request", async () => {
    const context = { configure: vi.fn() };
    const device = {
      createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
      createSampler: vi.fn(() => ({})),
      queue: { writeTexture: vi.fn() },
      limits: {},
    };
    const adapter = {
      features: new Set<string>([]),
      limits: {},
      requestDevice: vi.fn(async () => device),
    };
    const engine = new WebGPURenderingEngine({ scriptUrl: "slang.js", wasmUrl: "slang.wasm" });
    vi.stubGlobal("navigator", {
      gpu: {
        requestAdapter: vi.fn(async () => adapter),
        getPreferredCanvasFormat: vi.fn(() => "bgra8unorm"),
      },
    });
    vi.spyOn(engine as unknown as { createCompiler(): Promise<unknown> }, "createCompiler")
      .mockResolvedValue({ compile: vi.fn(), dispose: vi.fn() });
    try {
      engine.initialize({
        width: 800,
        height: 600,
        getContext: vi.fn(() => context),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLCanvasElement);
      await (engine as unknown as { ready: Promise<void> }).ready;
      expect(adapter.requestDevice).toHaveBeenCalledWith();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
