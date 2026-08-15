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

  test("teaches Code Spell Checker stable GLSL and Slang shader vocabulary", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const defaults = manifest.contributes.configurationDefaults;
    const glslWords = defaults["[glsl]"]["cSpell.words"] as string[];
    const slangWords = defaults["[slang]"]["cSpell.words"] as string[];

    for (const word of ["GLSL", "bvec", "faceforward", "inversesqrt", "ivec", "snorm", "texel", "unorm"]) {
      assert.ok(glslWords.includes(word), `missing GLSL cSpell word: ${word}`);
    }
    for (const word of [
      "WGSL", "asuint", "bitfield", "countbits", "firstbithigh", "fmod", "groupshared", "numthreads", "snorm", "unorm",
    ]) {
      assert.ok(slangWords.includes(word), `missing Slang cSpell word: ${word}`);
    }
    assert.ok(!glslWords.includes("gosperGliderGun"));
    assert.ok(!slangWords.includes("gosperGliderGun"));
  });
});
