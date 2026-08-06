import * as assert from "assert";
import * as path from "path";
import { collectSlangDependencies, resolveSlangIncludes, resolveSlangImports } from "../../app/SlangDependencyGraph";

suite("SlangDependencyGraph", () => {
  test("collects transitive imports in dependency-first order", () => {
    const files = new Map<string, string>([
      [path.normalize("/shader/palette.slang"), "module palette;\nimport tone_map;"],
      [path.normalize("/shader/tone-map.slang"), "module tone_map;"],
    ]);

    const result = collectSlangDependencies({
      rootPath: "/shader/image.slang",
      rootSource: "import palette;\nfloat4 mainImage(float2 p) { return 1; }",
      ownerPass: "Image",
      readSource: (filePath) => files.get(path.normalize(filePath)) ?? null,
    });

    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.modules.map((module) => module.moduleName), ["tone_map", "palette"]);
    assert.strictEqual(result.modules[0].ownerPass, "Image");
    assert.strictEqual(result.modules[1].path, path.normalize("/shader/palette.slang"));
  });

  test("deduplicates cycles without loading the root as its own dependency", () => {
    const files = new Map<string, string>([
      [path.normalize("/shader/a.slang"), "module a;\nimport b;"],
      [path.normalize("/shader/b.slang"), "module b;\nimport a;"],
    ]);

    const result = collectSlangDependencies({
      rootPath: "/shader/a.slang",
      rootSource: files.get(path.normalize("/shader/a.slang"))!,
      ownerPass: "Image",
      readSource: (filePath) => files.get(path.normalize(filePath)) ?? null,
    });

    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.modules.map((module) => module.moduleName), ["b"]);
  });

  test("returns a structured missing-module diagnostic", () => {
    const result = collectSlangDependencies({
      rootPath: "/shader/image.slang",
      rootSource: "import missing_palette;",
      ownerPass: "Image",
      readSource: () => null,
    });

    assert.deepStrictEqual(result.modules, []);
    assert.deepStrictEqual(result.errors, [{
      code: "slang-module-not-found",
      importerPath: path.normalize("/shader/image.slang"),
      moduleName: "missing_palette",
      resolvedPath: path.normalize("/shader/missing-palette.slang"),
      message: "Cannot resolve Slang module 'missing_palette' imported by /shader/image.slang",
    }]);
  });

  test("ignores only the reserved Shader Studio editor module", () => {
    const readPaths: string[] = [];
    const result = collectSlangDependencies({
      rootPath: "/shader/image.slang",
      rootSource: [
        "import shader_studio;",
        "import \"shader-studio.slang\";",
        "import palette;",
      ].join("\n"),
      ownerPass: "Image",
      readSource: (filePath) => {
        readPaths.push(path.normalize(filePath));
        return filePath.endsWith("palette.slang") ? "module palette;" : null;
      },
    });

    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.modules.map((module) => module.moduleName), ["palette"]);
    assert.deepStrictEqual(readPaths, [path.normalize("/shader/palette.slang")]);
  });
});

suite("resolveSlangIncludes", () => {
  const readSource = (files: Record<string, string>) => (filePath: string) => {
    const normalized = path.normalize(filePath);
    return normalized in files ? files[normalized]! : null;
  };

  test("inlines a single #include", () => {
    const files = {
      [path.normalize("/shader/include/tone-map.slang")]: "float3 toneMap(float3 c) { return c; }",
    };
    const source = '#include "include/tone-map.slang"\nfloat4 mainImage() { return 1; }';
    const { source: result } = resolveSlangIncludes(source, "/shader/image.slang", readSource(files));
    assert.strictEqual(result, "float3 toneMap(float3 c) { return c; }\nfloat4 mainImage() { return 1; }");
  });

  test("inlines nested #include directives", () => {
    const files = {
      [path.normalize("/shader/include/blur.slang")]: '#include "math.slang"\nfloat3 blur() { return smooth(); }',
      [path.normalize("/shader/include/math.slang")]: "float3 smooth() { return 1; }",
    };
    const source = '#include "include/blur.slang"\nfloat4 mainImage() { return 1; }';
    const { source: result } = resolveSlangIncludes(source, "/shader/image.slang", readSource(files));
    assert.strictEqual(result, "float3 smooth() { return 1; }\nfloat3 blur() { return smooth(); }\nfloat4 mainImage() { return 1; }");
  });

  test("leaves unresolved includes intact when the file is missing", () => {
    const source = '#include "missing.slang"\nfloat4 mainImage() { return 1; }';
    const { source: result } = resolveSlangIncludes(source, "/shader/image.slang", readSource({}));
    assert.strictEqual(result, source);
  });

  test("leaves cyclic includes unresolved", () => {
    const files = {
      [path.normalize("/shader/a.slang")]: '#include "b.slang"',
      [path.normalize("/shader/b.slang")]: '#include "a.slang"',
    };
    const source = '#include "a.slang"';
    // a -> b -> a cycle: the second a should be left unresolved
    const { source: result } = resolveSlangIncludes(source, "/shader/image.slang", readSource(files));
    assert.ok(result.includes('#include "a.slang"'));
  });

  test("resolves paths relative to the source file directory", () => {
    const files = {
      [path.normalize("/project/passes/include/util.slang")]: "void util() {}",
    };
    const source = '#include "include/util.slang"\nvoid main() { util(); }';
    const { source: result } = resolveSlangIncludes(source, "/project/passes/glow.slang", readSource(files));
    assert.strictEqual(result, "void util() {}\nvoid main() { util(); }");
  });

  test("handles source with no includes unchanged", () => {
    const source = "float4 mainImage() { return 1; }";
    const { source: result } = resolveSlangIncludes(source, "/shader/image.slang", readSource({}));
    assert.strictEqual(result, source);
  });

  test("inlines a __include (module-level, string form)", () => {
    const files = {
      [path.normalize("/shader/helpers.slang")]: "implementing scene;\nvoid helper() {}",
    };
    const source = '__include "helpers.slang"\nvoid main() { helper(); }';
    const { source: result } = resolveSlangIncludes(source, "/shader/scene.slang", readSource(files));
    assert.strictEqual(result, "implementing scene;\nvoid helper() {}\nvoid main() { helper(); }");
  });

  test("tracks included paths for dependency invalidation", () => {
    const files = {
      [path.normalize("/shader/include/tone-map.slang")]: "float3 toneMap(float3 c) { return c; }",
    };
    const source = '#include "include/tone-map.slang"\nfloat4 mainImage() { return 1; }';
    const { source: result, includedPaths } = resolveSlangIncludes(source, "/shader/image.slang", readSource(files));
    assert.strictEqual(result, "float3 toneMap(float3 c) { return c; }\nfloat4 mainImage() { return 1; }");
    assert.deepStrictEqual(includedPaths, [path.normalize("/shader/include/tone-map.slang")]);
  });
});

suite("resolveSlangImports", () => {
  const readSource = (files: Record<string, string>) => (filePath: string) => {
    const normalized = path.normalize(filePath);
    return normalized in files ? files[normalized]! : null;
  };

  test("inlines an identifier-path import", () => {
    const files = {
      [path.normalize("/shader/lib/palette.slang")]:
        "module palette;\npublic float3 paletteColor() { return float3(1,0,0); }",
    };
    const source = "import lib.palette;\nfloat4 mainImage() { return float4(paletteColor(), 1); }";
    const result = resolveSlangImports(source, "/shader/image.slang", readSource(files));
    assert.ok(result.includes("float3 paletteColor()"));
    assert.ok(result.includes("float4 mainImage()"));
    assert.ok(!result.includes("import lib.palette"));
    assert.ok(!result.includes("module palette"));
  });

  test("inlines a quoted-path import", () => {
    const files = {
      [path.normalize("/shader/passes/../lib/palette.slang")]:
        "public float3 paletteColor() { return float3(1,0,0); }",
    };
    const source = 'import "../lib/palette.slang";\nfloat4 mainImage() { return float4(paletteColor(), 1); }';
    const result = resolveSlangImports(source, "/shader/passes/glow.slang", readSource(files));
    assert.ok(result.includes("float3 paletteColor()"));
    assert.ok(!result.includes("import"));
  });

  test("leaves shader_studio editor import intact", () => {
    const source = "import shader_studio;\nfloat4 mainImage() { return 1; }";
    const result = resolveSlangImports(source, "/shader/image.slang", readSource({}));
    assert.ok(result.includes("import shader_studio"));
  });

  test("leaves source without imports unchanged", () => {
    const source = "float4 mainImage() { return 1; }";
    const result = resolveSlangImports(source, "/shader/image.slang", readSource({}));
    assert.strictEqual(result, source);
  });

  test("leaves unresolved import intact", () => {
    const source = "import missing.module;\nfloat4 mainImage() { return 1; }";
    const result = resolveSlangImports(source, "/shader/image.slang", readSource({}));
    assert.ok(result.includes("import missing.module"));
  });

  test("recursively inlines transitive imports", () => {
    const files = {
      [path.normalize("/shader/lib/color.slang")]:
        "module color;\npublic float3 getColor() { return float3(1,0,0); }",
      [path.normalize("/shader/lib/palette.slang")]:
        'import "color.slang";\nmodule palette;\npublic float3 paletteColor() { return getColor(); }',
    };
    const source = "import lib.palette;\nfloat4 mainImage() { return float4(paletteColor(), 1); }";
    const result = resolveSlangImports(source, "/shader/image.slang", readSource(files));
    assert.ok(result.includes("float3 getColor()"));
    assert.ok(result.includes("float3 paletteColor()"));
    assert.ok(!result.includes("import"));
    assert.ok(!result.includes("module"));
  });

  test("detects and breaks import cycles", () => {
    const files = {
      [path.normalize("/shader/a.slang")]: 'module a;\nimport "b.slang";\npublic float3 colorA() { return colorB(); }',
      [path.normalize("/shader/b.slang")]: 'module b;\nimport "a.slang";\npublic float3 colorB() { return colorA(); }',
    };
    const source = 'import "a.slang";\nfloat4 mainImage() { return float4(colorA(), 1); }';
    const result = resolveSlangImports(source, "/shader/image.slang", readSource(files));
    // a is inlined, a's import of b is inlined, b's import of a is left (cycle)
    assert.ok(result.includes("import"));
  });
  });
});
