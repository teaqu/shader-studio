import * as assert from "assert";

import { SlangDependencyGraph } from "../../app/SlangDependencyGraph";

suite("SlangDependencyGraph", () => {
  const root = "file:///workspace/image.slang";
  const nestedRoot = "file:///workspace/effects/image.slang";

  test("extracts identifier, dotted, string, include, and __include dependencies", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    graph.update(root, [
      "import palette;",
      "import lighting.brdf;",
      'import "lib/math.slang";',
      '#include "include/color.slang"',
      '__include("generated/constants.slang")',
    ].join("\n"));

    assert.deepStrictEqual([...graph.directDependencies(root)].sort(), [
      "file:///workspace/generated/constants.slang",
      "file:///workspace/include/color.slang",
      "file:///workspace/lib/math.slang",
      "file:///workspace/lighting.brdf.slang",
      "file:///workspace/lighting/brdf.slang",
      "file:///workspace/palette.slang",
    ]);
  });

  test("normalizes relative references and workspace aliases", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    graph.update(nestedRoot, [
      'import "../lib/./math.slang";',
      '#include "@/shared/color.slang"',
    ].join("\n"));

    assert.deepStrictEqual([...graph.directDependencies(nestedRoot)].sort(), [
      "file:///workspace/lib/math.slang",
      "file:///workspace/shared/color.slang",
    ]);
  });

  test("preserves Windows separators in quoted imports and include directives", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    graph.update(root, [
      'import "lib\\math.slang";',
      '#include "include\\color.slang"',
      '__include("generated\\constants.slang")',
    ].join("\n"));

    assert.deepStrictEqual([...graph.directDependencies(root)].sort(), [
      "file:///workspace/generated/constants.slang",
      "file:///workspace/include/color.slang",
      "file:///workspace/lib/math.slang",
    ]);
  });

  test("keeps both local and workspace-root candidates for ambiguous module imports", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    graph.update(nestedRoot, "import palette;");

    assert.deepStrictEqual([...graph.directDependencies(nestedRoot)].sort(), [
      "file:///workspace/effects/palette.slang",
      "file:///workspace/palette.slang",
    ]);
  });

  test("keeps exact and Slang-suffixed candidates for extensionless string imports", () => {
    const graph = new SlangDependencyGraph();
    graph.update(root, 'import "lib/math";');

    assert.deepStrictEqual([...graph.directDependencies(root)].sort(), [
      "file:///workspace/lib/math",
      "file:///workspace/lib/math.slang",
    ]);
  });

  test("ignores dependency-looking text in comments and ordinary strings", () => {
    const graph = new SlangDependencyGraph();
    graph.update(root, [
      "// import hidden;",
      "/* #include \"also-hidden.slang\" */",
      'let text = "import stringHidden;";',
      "import visible;",
    ].join("\n"));

    assert.deepStrictEqual([...graph.directDependencies(root)], [
      "file:///workspace/visible.slang",
    ]);
  });

  test("keeps parser offsets aligned after non-BMP characters", () => {
    const graph = new SlangDependencyGraph();
    graph.update(root, [
      'let emoji = "😀 import hidden;";',
      "import visible;",
    ].join("\n"));

    assert.deepStrictEqual([...graph.directDependencies(root)], [
      "file:///workspace/visible.slang",
    ]);
  });

  test("finds transitive affected roots through cycles and shared dependencies", () => {
    const graph = new SlangDependencyGraph();
    const rootA = "file:///workspace/a.slang";
    const rootB = "file:///workspace/b.slang";
    const middle = "file:///workspace/middle.slang";
    const shared = "file:///workspace/shared.slang";

    graph.update(rootA, 'import "middle.slang";');
    graph.update(middle, 'import "shared.slang";');
    graph.update(shared, 'import "middle.slang";');
    graph.update(rootB, 'import "shared.slang";');

    assert.deepStrictEqual(
      [...graph.affectedRoots(shared, new Set([rootA, rootB]))].sort(),
      [rootA, rootB],
    );
  });

  test("broadens invalidation when a module import cannot be mapped to a filename", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    graph.update(root, "import palette;");

    assert.deepStrictEqual([
      ...graph.affectedRoots("file:///workspace/lib/colors.slang", new Set([root])),
    ], [root]);
  });

  test("matches declared module identity instead of invalidating every module importer", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    const palette = "file:///workspace/generated/colors.slang";
    const unrelated = "file:///workspace/generated/noise.slang";
    graph.update(root, "import palette;");
    graph.update(palette, "module palette; float4 color();");
    graph.update(unrelated, "module unrelated; float noise();");

    assert.deepStrictEqual([...graph.affectedRoots(palette, new Set([root]))], [root]);
    assert.deepStrictEqual([...graph.affectedRoots(unrelated, new Set([root]))], []);
  });

  test("invalidates importers when a module declaration is renamed or removed", () => {
    const graph = new SlangDependencyGraph("file:///workspace");
    const generated = "file:///workspace/generated/colors.slang";
    graph.update(root, "import palette;");
    graph.update(generated, "module palette; float4 color();");

    graph.update(generated, "module renamed; float4 color();");

    assert.deepStrictEqual([...graph.affectedRoots(generated, new Set([root]))], [root]);

    graph.update(generated, "module palette; float4 color();");
    graph.remove(generated);

    assert.deepStrictEqual([...graph.affectedRoots(generated, new Set([root]))], [root]);
  });

  test("keeps incoming ownership when a dependency is deleted", () => {
    const graph = new SlangDependencyGraph();
    const dependency = "file:///workspace/lib.slang";
    graph.update(root, 'import "lib.slang";');
    graph.update(dependency, "float value;");

    graph.remove(dependency);

    assert.deepStrictEqual([...graph.affectedRoots(dependency, new Set([root]))], [root]);
    assert.deepStrictEqual([...graph.directDependencies(dependency)], []);
  });

  test("replaces stale reverse edges when a source changes", () => {
    const graph = new SlangDependencyGraph();
    const oldDependency = "file:///workspace/old.slang";
    const nextDependency = "file:///workspace/next.slang";
    graph.update(root, 'import "old.slang";');

    graph.update(root, 'import "next.slang";');

    assert.deepStrictEqual([...graph.affectedRoots(oldDependency, new Set([root]))], []);
    assert.deepStrictEqual([...graph.affectedRoots(nextDependency, new Set([root]))], [root]);
  });

  test("rejects dependency traversal outside a configured workspace", () => {
    const graph = new SlangDependencyGraph("file:///workspace");

    assert.throws(
      () => graph.update(root, '#include "../secret.slang"'),
      /outside the Slang workspace root/,
    );
  });

  test("matches Windows workspace paths case-insensitively", () => {
    const graph = new SlangDependencyGraph("file:///C:/Workspace");

    assert.doesNotThrow(() => {
      graph.update("file:///c:/workspace/image.slang", 'import "lib/math.slang";');
    });
    assert.deepStrictEqual([
      ...graph.directDependencies("file:///C:/WORKSPACE/image.slang"),
    ], ["file:///c:/workspace/lib/math.slang"]);
  });
});
