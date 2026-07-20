import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Slang language assets", () => {
  const extensionRoot = path.resolve(__dirname, "..", "..");

  test("declares a dedicated Slang language, grammar, and configuration", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
    const language = manifest.contributes.languages.find((entry: { id: string }) => entry.id === "slang");
    const grammar = manifest.contributes.grammars.find((entry: { language: string }) => entry.language === "slang");

    assert.deepStrictEqual(language.extensions, [".slang"]);
    assert.strictEqual(language.configuration, "./slang-language-configuration.json");
    assert.deepStrictEqual(grammar, {
      language: "slang",
      scopeName: "source.slang",
      path: "./syntaxes/slang.tmLanguage.json",
    });
  });

  test("ships Slang-specific lexical and editing configuration", () => {
    const grammar = JSON.parse(fs.readFileSync(path.join(extensionRoot, "syntaxes/slang.tmLanguage.json"), "utf8"));
    const configuration = JSON.parse(fs.readFileSync(path.join(extensionRoot, "slang-language-configuration.json"), "utf8"));
    const serialized = JSON.stringify(grammar);

    assert.strictEqual(grammar.scopeName, "source.slang");
    for (const token of [
      "module", "import", "implementing", "__include", "interface", "__generic",
      "shader", "float4", "Texture", "meta.preprocessor", "comment", "string", "numeric",
    ]) {
      assert.ok(serialized.includes(token), `grammar should cover ${token}`);
    }
    assert.deepStrictEqual(configuration.comments, { lineComment: "//", blockComment: ["/*", "*/"] });
    assert.ok(Array.isArray(configuration.brackets));
    assert.ok(Array.isArray(configuration.autoClosingPairs));
    assert.ok(typeof configuration.wordPattern === "string");
  });

  test("does not declare Slang language-service configuration", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));

    assert.strictEqual(
      manifest.contributes.configuration.properties["shader-studio.slangLanguageFeatures"],
      undefined,
    );
  });

  test("does not bundle a Slang language worker", () => {
    const esbuild = fs.readFileSync(path.join(extensionRoot, "esbuild.js"), "utf8");

    assert.ok(!esbuild.includes("slangLanguageWorker.ts"));
  });
});
