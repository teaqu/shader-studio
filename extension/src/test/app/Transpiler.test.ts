import { GlslToJsTranspiler } from "../../app/Transpiler";
import * as fs from "fs";
import * as path from "path";
import * as assert from "assert";

suite("GlslToJsTranspiler", () => {
  const testShader = `
    uniform float iTime;
    void mainImage(out vec4 fragColor, in vec2 fragCoord) {
      fragColor = vec4(iTime, fragCoord.x, fragCoord.y, 1.0);
    }
  `;
  const testFile = path.join(__dirname, "test-shader.glsl");

  setup(() => {
    fs.writeFileSync(testFile, testShader, "utf8");
  });
  teardown(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    const outFile = testFile.replace(/\.(glsl|frag|vert)$/i, ".transpiled.js");
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  });

  test("transpiles GLSL to JS and writes file", () => {
    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("let iResolution = [960, 540, 1];"));
    assert.ok(output && output.includes("mainImage(fragColor, fragCoord);"));
    const outPath = GlslToJsTranspiler.writeTranspiledFile({ fsPath: testFile }, output!);
    assert.ok(fs.existsSync(outPath));
    const written = fs.readFileSync(outPath, "utf8");
    assert.ok(written.includes("fragColor"));
  });

  test("throws error for non-GLSL file", () => {
    const nonGlslFile = path.join(__dirname, "test.txt");
    fs.writeFileSync(nonGlslFile, "hello world", "utf8");
    assert.throws(() => {
      GlslToJsTranspiler.transpileFile({ fsPath: nonGlslFile });
    }, /Selected file is not a GLSL shader/);
    fs.unlinkSync(nonGlslFile);
  });

});
