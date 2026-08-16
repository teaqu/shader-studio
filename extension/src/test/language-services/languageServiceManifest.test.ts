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
    assert.strictEqual(properties["shader-studio.languageServers.trace"], undefined);
  });

  test("opens shader color pickers only when their swatches are clicked", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const defaults = manifest.contributes.configurationDefaults;
    assert.strictEqual(defaults["[glsl]"]["editor.colorDecoratorsActivatedOn"], "click");
    assert.strictEqual(defaults["[slang]"]["editor.colorDecoratorsActivatedOn"], "click");
  });

  test("packages additive GLSL and Slang dictionaries for Code Spell Checker", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const defaults = manifest.contributes.configurationDefaults;
    assert.strictEqual(defaults["[glsl]"]["cSpell.words"], undefined);
    assert.strictEqual(defaults["[slang]"]["cSpell.words"], undefined);

    const extensionRoot = path.resolve(__dirname, "../../..");
    const config = JSON.parse(fs.readFileSync(path.join(extensionRoot, "cspell-ext.json"), "utf8"));
    assert.deepStrictEqual(config.languageSettings.map((setting: { languageId: string }) => setting.languageId), ["glsl", "slang"]);
    const glslWords = fs.readFileSync(path.join(extensionRoot, "dictionaries/glsl.txt"), "utf8").split(/\s+/);
    const slangWords = fs.readFileSync(path.join(extensionRoot, "dictionaries/slang.txt"), "utf8").split(/\s+/);
    assert.ok(glslWords.includes("faceforward"));
    assert.ok(glslWords.includes("texel"));
    assert.ok(slangWords.includes("groupshared"));
    assert.ok(slangWords.includes("numthreads"));
    assert.ok(!glslWords.includes("gosperGliderGun"));
    assert.ok(!slangWords.includes("gosperGliderGun"));
  });
});
