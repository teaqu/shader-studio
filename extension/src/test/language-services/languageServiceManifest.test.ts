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

  test("opens shader color pickers only when their swatches are clicked", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const defaults = manifest.contributes.configurationDefaults;
    assert.strictEqual(defaults["[glsl]"]["editor.colorDecoratorsActivatedOn"], "click");
    assert.strictEqual(defaults["[slang]"]["editor.colorDecoratorsActivatedOn"], "click");
  });

  test("teaches Code Spell Checker the Slang compute attribute spelling", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const slangDefaults = manifest.contributes.configurationDefaults["[slang]"];
    assert.ok(slangDefaults["cSpell.words"].includes("numthreads"));
  });
});
