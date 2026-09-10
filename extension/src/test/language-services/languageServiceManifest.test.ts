import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("language service manifest", () => {
  test("declares independently live-configurable services and colors", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const properties = manifest.contributes.configuration.properties;
    assert.strictEqual(properties["shader-studio.languageServers.glsl.enabled"].default, true);
    assert.strictEqual(properties["shader-studio.languageServers.slang.enabled"].default, true);
    assert.strictEqual(properties["shader-studio.languageServers.wgsl.enabled"].default, true);
    assert.strictEqual(properties["shader-studio.editor.colorDecorators"].default, true);
    assert.strictEqual(properties["shader-studio.languageServers.trace"], undefined);
  });

  test("opens shader color pickers only when their swatches are clicked", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const defaults = manifest.contributes.configurationDefaults;
    assert.strictEqual(defaults["[glsl]"]["editor.colorDecoratorsActivatedOn"], "click");
    assert.strictEqual(defaults["[slang]"]["editor.colorDecoratorsActivatedOn"], "click");
    assert.strictEqual(defaults["[wgsl]"]["editor.colorDecoratorsActivatedOn"], "click");
  });

  test("registers the WGSL language id, file extension, and grammar", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const languages = manifest.contributes.languages as Array<{ id: string; extensions?: string[]; configuration?: string }>;
    const wgsl = languages.find((entry) => entry.id === "wgsl");
    assert.ok(wgsl, "expected a wgsl language contribution");
    assert.ok(wgsl.extensions?.includes(".wgsl"));
    assert.ok(wgsl.configuration?.endsWith("wgsl-language-configuration.json"));

    const grammars = manifest.contributes.grammars as Array<{ language: string; scopeName: string; path: string }>;
    const wgslGrammar = grammars.find((entry) => entry.language === "wgsl");
    assert.ok(wgslGrammar, "expected a wgsl grammar contribution");
    assert.strictEqual(wgslGrammar.scopeName, "source.wgsl");

    const extensionRoot = path.resolve(__dirname, "../../..");
    assert.ok(fs.existsSync(path.join(extensionRoot, wgsl.configuration!)));
    const grammarPath = path.join(extensionRoot, wgslGrammar.path);
    assert.ok(fs.existsSync(grammarPath));
    const grammar = JSON.parse(fs.readFileSync(grammarPath, "utf8"));
    assert.strictEqual(grammar.scopeName, "source.wgsl");
    assert.ok(Array.isArray(grammar.patterns) && grammar.patterns.length > 0);
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
