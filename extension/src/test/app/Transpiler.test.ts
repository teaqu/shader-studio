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
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
    const outFile = testFile.replace(/\.(glsl|frag|vert)$/i, ".transpiled.js");
    if (fs.existsSync(outFile)) {
      fs.unlinkSync(outFile);
    }
    const configFile = testFile.replace(/\.glsl$/, ".sha.json");
    if (fs.existsSync(configFile)) {
      fs.unlinkSync(configFile);
    }
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

  test("includes Common buffer code in transpilation output", () => {
    const commonFile = path.join(__dirname, "test-common.glsl");
    const configFile = testFile.replace(/\.glsl$/, ".sha.json");

    fs.writeFileSync(commonFile, "float myHelper(float x) { return x * 2.0; }\n", "utf8");
    fs.writeFileSync(configFile, JSON.stringify({
      version: "1.0",
      passes: {
        Image: { inputs: {} },
        common: { path: commonFile }
      }
    }), "utf8");

    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("myHelper"));

    fs.unlinkSync(commonFile);
    fs.unlinkSync(configFile);
  });

  test("transpiles without Common when no config exists", () => {
    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("mainImage(fragColor, fragCoord);"));
    assert.ok(output && !output.includes("myHelper"));
  });

  test("transpiles without Common when config has no common pass", () => {
    const configFile = testFile.replace(/\.glsl$/, ".sha.json");
    fs.writeFileSync(configFile, JSON.stringify({
      version: "1.0",
      passes: { Image: { inputs: {} } }
    }), "utf8");

    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("mainImage(fragColor, fragCoord);"));
    assert.ok(output && !output.includes("myHelper"));

    fs.unlinkSync(configFile);
  });

  test("transpiles without Common when common file is missing", () => {
    const configFile = testFile.replace(/\.glsl$/, ".sha.json");
    fs.writeFileSync(configFile, JSON.stringify({
      version: "1.0",
      passes: {
        Image: { inputs: {} },
        common: { path: "missing-file.glsl" }
      }
    }), "utf8");

    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("mainImage(fragColor, fragCoord);"));
    assert.ok(output && !output.includes("missing-file"));

    fs.unlinkSync(configFile);
  });

  test("transpiles without Common when config is malformed", () => {
    const configFile = testFile.replace(/\.glsl$/, ".sha.json");
    fs.writeFileSync(configFile, "this is not json", "utf8");

    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("mainImage(fragColor, fragCoord);"));

    fs.unlinkSync(configFile);
  });

  test("includes Common uniforms in transpilation output", () => {
    const commonFile = path.join(__dirname, "test-common-uniforms.glsl");
    const configFile = testFile.replace(/\.glsl$/, ".sha.json");

    fs.writeFileSync(commonFile, "uniform vec3 uCustomColor;\n", "utf8");
    fs.writeFileSync(configFile, JSON.stringify({
      version: "1.0",
      passes: {
        Image: { inputs: {} },
        common: { path: commonFile }
      }
    }), "utf8");

    const output = GlslToJsTranspiler.transpileFile({ fsPath: testFile });
    assert.ok(output && output.includes("uCustomColor"));

    fs.unlinkSync(commonFile);
    fs.unlinkSync(configFile);
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
