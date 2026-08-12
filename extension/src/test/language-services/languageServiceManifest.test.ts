import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("language service manifest", () => {
  test("declares independently live-configurable services and colors", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const properties = manifest.contributes.configuration.properties;
    assert.strictEqual(properties["shader-studio.languageServers.glsl.enabled"].default, true);
    assert.strictEqual(properties["shader-studio.languageServers.slang.enabled"].default, true);
    assert.strictEqual(properties["shader-studio.editor.colorDecorators"].default, true);
    assert.strictEqual(properties["shader-studio.languageServers.trace"].default, "off");
  });
});
