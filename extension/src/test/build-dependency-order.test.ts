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
});
