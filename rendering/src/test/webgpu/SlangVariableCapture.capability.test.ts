import { beforeAll, describe, expect, it } from "vitest";
import SlangModuleFactory from "../../../../ui/src/slang/slang-wasm.js";
import { VariableCaptureBuilder } from "../../../../debug/src/VariableCaptureBuilder";
import {
  SlangCompiler,
  type SlangCompileOptions,
} from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

interface CapabilityFixture {
  name: string;
  source: string;
  marker: string;
  expectExactNameBinding?: boolean;
  expected: {
    varName: string;
    varType: string;
    declarationLine: number;
  };
  options?: SlangCompileOptions;
  selectorCompilation?: (selector: string) => {
    source: string;
    options: SlangCompileOptions;
  };
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
    expectExactNameBinding: true,
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
    selectorCompilation: (selector) => ({
      source: importedImageSource,
      options: {
        captureMode: true,
        sourcePath: "/fixtures/image.slang",
        modules: [{
          moduleName: "importedmath",
          path: "/fixtures/importedmath.slang",
          source: selector,
        }],
      },
    }),
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

  it.each(fixtures)("captures $name through a generated Slang selector", (fixture) => {
    const untouchedResult = compiler.compileImagePass(fixture.source, fixture.options);
    expect(untouchedResult).toMatchObject({ success: true });

    const captureSource = fixture.options?.modules?.[0]?.source ?? fixture.source;
    const selectedLine = findMarkerLine(captureSource, fixture.marker);
    expect(selectedLine).toBe(fixture.expected.declarationLine);

    const variables = VariableCaptureBuilder.getAllInScopeVariables(captureSource, selectedLine);
    if (fixture.expectExactNameBinding) {
      expect(variables.filter((variable) => variable.varName === fixture.expected.varName))
        .toEqual([fixture.expected]);
    } else {
      expect(variables).toContainEqual(fixture.expected);
    }

    const selector = VariableCaptureBuilder.generateMultiCaptureShader(
      captureSource,
      selectedLine,
      variables,
      new Map(),
      new Map(),
      false,
      32,
      32,
      "slang",
    );
    expect(selector).not.toBeNull();

    const selectorInput = fixture.selectorCompilation?.(selector!) ?? {
      source: selector!,
      options: { ...fixture.options, captureMode: true },
    };
    const selectorResult = compiler.compileImagePass(selectorInput.source, selectorInput.options);
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
