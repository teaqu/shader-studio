import { beforeAll, describe, expect, it } from "vitest";
import SlangModuleFactory from "../../../../ui/src/slang/slang-wasm.js";
import { SlangDebugEngine } from "../../../../debug/src";
import {
  SlangCompiler,
  type SlangCompileOptions,
} from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

interface CapabilityFixture {
  name: string;
  source: string;
  marker: string;
  expected: {
    varName: string;
    varType: string;
    declarationLine: number;
  };
  options?: SlangCompileOptions;
}

const importedModuleSource = `module importedmath;

public float importedHelper(float input)
{
    float importedLocal = input * 0.75; // @capture imported-local
    return importedLocal;
}`;

const importedImageSource = `import importedmath;

float4 mainImage(float2 fragCoord)
{
    return float4(importedHelper(fragCoord.x), 0.0, 0.0, 1.0);
}`;

const fixtures: CapabilityFixture[] = [
  {
    name: "overloaded free functions",
    source: `float overloaded(float input)
{
    float overloadedLocal = input * 2.0; // @capture overloaded-local
    return overloadedLocal;
}

int overloaded(int input)
{
    return input;
}

float4 mainImage(float2 fragCoord)
{
    return float4(overloaded(fragCoord.x), 0.0, 0.0, 1.0);
}`,
    marker: "@capture overloaded-local",
    expected: { varName: "overloadedLocal", varType: "float", declarationLine: 2 },
  },
  {
    name: "a struct instance method",
    source: `struct Multiplier
{
    float scale;

    float apply(float input)
    {
        float methodLocal = input * scale; // @capture struct-method-local
        return methodLocal;
    }
};

float4 mainImage(float2 fragCoord)
{
    Multiplier multiplier;
    multiplier.scale = 0.5;
    return float4(multiplier.apply(fragCoord.x), 0.0, 0.0, 1.0);
}`,
    marker: "@capture struct-method-local",
    expected: { varName: "methodLocal", varType: "float", declarationLine: 6 },
  },
  {
    name: "a specialized generic helper",
    source: `float genericHelper<T>(T input)
{
    float genericLocal = 0.75; // @capture generic-local
    return genericLocal;
}

float4 mainImage(float2 fragCoord)
{
    return float4(genericHelper<float>(fragCoord.x), 0.0, 0.0, 1.0);
}`,
    marker: "@capture generic-local",
    expected: { varName: "genericLocal", varType: "float", declarationLine: 2 },
  },
  {
    name: "an interface-conforming method",
    source: `interface ValueSource
{
    float value();
}

struct FloatValue : ValueSource
{
    float value()
    {
        float interfaceLocal = 0.25; // @capture interface-local
        return interfaceLocal;
    }
};

float4 mainImage(float2 fragCoord)
{
    FloatValue value;
    return float4(value.value(), 0.0, 0.0, 1.0);
}`,
    marker: "@capture interface-local",
    expected: { varName: "interfaceLocal", varType: "float", declarationLine: 9 },
  },
  {
    name: "an extension method",
    source: `struct ExtensionInput
{
    float value;
};

extension ExtensionInput
{
    float extended()
    {
        float extensionLocal = value * 0.5; // @capture extension-local
        return extensionLocal;
    }
}

float4 mainImage(float2 fragCoord)
{
    ExtensionInput input;
    input.value = fragCoord.x;
    return float4(input.extended(), 0.0, 0.0, 1.0);
}`,
    marker: "@capture extension-local",
    expected: { varName: "extensionLocal", varType: "float", declarationLine: 9 },
  },
  {
    name: "an attributed helper declaration",
    source: `[ForceInline]
float attributed(float input)
{
    float attributedLocal = input * 0.5; // @capture attributed-local
    return attributedLocal;
}

float4 mainImage(float2 fragCoord)
{
    return float4(attributed(fragCoord.x), 0.0, 0.0, 1.0);
}`,
    marker: "@capture attributed-local",
    expected: { varName: "attributedLocal", varType: "float", declarationLine: 3 },
  },
  {
    name: "nested scopes with a shadowed variable",
    source: `float nested(float input)
{
    float shadowed = input;
    {
        float shadowed = input * 2.0; // @capture nested-shadowed
        return shadowed;
    }
}

float4 mainImage(float2 fragCoord)
{
    return float4(nested(fragCoord.x), 0.0, 0.0, 1.0);
}`,
    marker: "@capture nested-shadowed",
    expected: { varName: "shadowed", varType: "float", declarationLine: 4 },
  },
  {
    name: "a macro that expands to a local declaration",
    source: `#define DECLARE_FLOAT(name, value) float name = value

float macroHelper(float input)
{
    DECLARE_FLOAT(macroLocal, input * 0.5); // @capture macro-local
    return macroLocal;
}

float4 mainImage(float2 fragCoord)
{
    return float4(macroHelper(fragCoord.x), 0.0, 0.0, 1.0);
}`,
    marker: "@capture macro-local",
    expected: { varName: "macroLocal", varType: "float", declarationLine: 4 },
  },
  {
    name: "a helper selected inside an imported module while Image retains its import",
    source: importedImageSource,
    marker: "@capture imported-local",
    expected: { varName: "importedLocal", varType: "float", declarationLine: 4 },
    options: {
      sourcePath: "/fixtures/image.slang",
      modules: [{
        moduleName: "importedmath",
        path: "/fixtures/importedmath.slang",
        source: importedModuleSource,
      }],
    },
  },
];

describe("Slang variable capture advanced-syntax capability", () => {
  let compiler: SlangCompiler;

  beforeAll(async () => {
    const slang = await SlangModuleFactory({
      locateFile: () => new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url).pathname
        .replace(/^\/@fs/, ""),
    });
    compiler = new SlangCompiler(slang as unknown as SlangModuleApi);
  });

  it.each(fixtures)("compiles untouched $name", (fixture) => {
    expect(compiler.compileImagePass(fixture.source, fixture.options)).toMatchObject({ success: true });
  });

  it.each(fixtures)("compiles an instrumented capture workspace for $name", (fixture) => {
    const untouchedResult = compiler.compileImagePass(fixture.source, fixture.options);
    expect(untouchedResult).toMatchObject({ success: true });

    const captureSource = fixture.options?.modules?.[0]?.source ?? fixture.source;
    const selectedLine = findMarkerLine(captureSource, fixture.marker);
    expect(selectedLine).toBe(fixture.expected.declarationLine);

    const rootPath = fixture.options?.sourcePath ?? "/fixtures/image.slang";
    const selectedModule = fixture.options?.modules?.[0];
    const selectedPath = selectedModule?.path ?? rootPath;
    const workspace = {
      rootUri: rootPath,
      rootPath,
      passName: "Image",
      contentHash: `fixture-${fixture.name}`,
      files: [
        { uri: rootPath, path: rootPath, source: fixture.source, version: 1, moduleName: "", ownerPass: "Image" },
        ...(fixture.options?.modules ?? []).map((module) => ({ uri: module.path ?? module.moduleName, path: module.path ?? module.moduleName, source: module.source, version: 1, moduleName: module.moduleName, ownerPass: "Image" })),
      ],
    };
    const engine = new SlangDebugEngine();
    const selectedCharacter = captureSource.split("\n")[selectedLine]?.search(/\S/) ?? 0;
    const request = { workspace, sourceUri: selectedPath, position: { line: selectedLine, character: selectedCharacter } };
    const analysis = engine.analyze(request);
    expect(analysis.ok, analysis.ok ? "" : analysis.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    if (!analysis.ok) {
      return;
    }
    expect(analysis.analysis.visibleValues).toContainEqual(expect.objectContaining({ name: fixture.expected.varName, typeName: fixture.expected.varType }));
    const selected = analysis.analysis.visibleValues.find((value) => value.name === fixture.expected.varName && value.typeName === fixture.expected.varType);
    expect(selected).toBeDefined();
    const preview = engine.planPreview(request, { normalizeMode: "off", stepEdge: null });
    expect(preview.ok, preview.ok ? "" : preview.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    if (!preview.ok) {
      return;
    }
    const previewRoot = preview.plan.files.find((file) => file.uri === "file:///fixtures/image.slang")!;
    const previewModules = preview.plan.files
      .filter((file) => file.uri !== previewRoot.uri)
      .map((file) => ({ moduleName: file.moduleName, path: file.path, source: file.source }));
    expect(compiler.compileImagePass(previewRoot.source, { passName: "Image", sourcePath: previewRoot.path, modules: previewModules })).toMatchObject({ success: true });
    const plan = engine.planCapture(request, [selected!.id]);
    expect(plan.ok, plan.ok ? "" : plan.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toBe(true);
    if (!plan.ok) {
      return;
    }
    const root = plan.plan.files.find((file) => file.uri === "file:///fixtures/image.slang")!;
    const modules = plan.plan.files
      .filter((file) => file.uri !== root.uri)
      .map((file) => ({ moduleName: file.moduleName, path: file.path, source: file.source }));
    const selectorResult = compiler.compileImagePass(root.source, { passName: "Image", sourcePath: root.path, modules, captureMode: true });
    expect(
      selectorResult.success,
      selectorResult.success ? "" : selectorResult.errors.join("\n"),
    ).toBe(true);
  });
});

function findMarkerLine(source: string, marker: string): number {
  const matches = source.split("\n")
    .map((line, lineNumber) => ({ line, lineNumber }))
    .filter(({ line }) => line.includes(marker));

  expect(matches).toHaveLength(1);
  return matches[0]?.lineNumber ?? -1;
}
