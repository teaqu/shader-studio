import * as assert from "assert";
import * as path from "path";
import { collectSlangDependencies } from "../../app/SlangDependencyGraph";

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
