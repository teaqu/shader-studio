import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("workspace dependency build order", () => {
  test("builds utils before packages that import it", () => {
    const manifestPath = path.resolve(__dirname, "../../package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    const buildDependencies = manifest.scripts["build:deps"];

    assert.ok(buildDependencies);
    assert.ok(
      buildDependencies.indexOf("utils") < buildDependencies.indexOf("debug"),
      "utils must be built before debug because debug imports @shader-studio/utils",
    );
  });

  test("excludes end-to-end test assets from the release package", () => {
    const ignorePath = path.resolve(__dirname, "../../.vscodeignore");
    const ignoredPaths = fs.readFileSync(ignorePath, "utf8").split(/\r?\n/);

    assert.ok(ignoredPaths.includes("e2e/**"));
    assert.ok(ignoredPaths.includes(".playwright/**"));
    assert.ok(ignoredPaths.includes("tsconfig.test.json"));
    assert.ok(ignoredPaths.includes("**/test/**"));
    assert.ok(ignoredPaths.includes("**/tests/**"));
    assert.ok(ignoredPaths.includes("**/*.test.*"));
    assert.ok(ignoredPaths.includes("**/*.spec.*"));
  });
});
