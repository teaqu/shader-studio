import { describe, expect, it } from "vitest";
import { dedupeCompilerErrors, firstReportedErrorLine, splitCompilerErrorBlocks } from "../../util/CompilerErrorDedupe";

const commonBlock = [
  "error[E20002]: syntax error",
  "  --> /shaders/common.slang:5:18",
  "   |",
  "5  | float helper() { return; }",
].join("\n");

describe("dedupeCompilerErrors", () => {
  it("returns the input untouched when there is nothing to collapse", () => {
    expect(dedupeCompilerErrors(undefined)).toEqual([]);
    expect(dedupeCompilerErrors([])).toEqual([]);
    expect(dedupeCompilerErrors(["Image: error[E30015]: undefined identifier 'stepp'"]))
      .toEqual(["Image: error[E30015]: undefined identifier 'stepp'"]);
  });

  it("collapses one shared-module error reported by every pass", () => {
    const errors = ["Image", "BufferA", "BufferB"].map((pass) => `${pass}: ${commonBlock}`);

    const result = dedupeCompilerErrors(errors);

    expect(result).toEqual([`Image: ${commonBlock}`]);
  });

  it("keeps pass-specific blocks while dropping the repeated shared one", () => {
    const imageOwn = [
      "error[E30015]: undefined identifier 'stepp'",
      "  --> /shaders/image.slang:14:15",
    ].join("\n");

    const result = dedupeCompilerErrors([
      `Image: ${commonBlock}\n${imageOwn}`,
      `BufferA: ${commonBlock}`,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("common.slang:5:18");
    expect(result[0]).toContain("image.slang:14:15");
  });

  it("re-attaches the pass prefix when the prefixed block is the one dropped", () => {
    const bufferOwn = [
      "error[E30015]: undefined identifier 'noise'",
      "  --> /shaders/buffera.slang:7:9",
    ].join("\n");

    const result = dedupeCompilerErrors([
      `Image: ${commonBlock}`,
      `BufferA: ${commonBlock}\n${bufferOwn}`,
    ]);

    expect(result).toHaveLength(2);
    expect(result[1].startsWith("BufferA: error[E30015]: undefined identifier 'noise'")).toBe(true);
    expect(result[1]).not.toContain("common.slang");
  });

  it("treats the same location reported at different columns as distinct errors", () => {
    const other = commonBlock.replace(":5:18", ":5:24");

    expect(dedupeCompilerErrors([`Image: ${commonBlock}`, `BufferA: ${other}`])).toHaveLength(2);
  });

  it("keeps unlocated errors from different passes because each pass really failed", () => {
    const result = dedupeCompilerErrors([
      "Image: error[E99999]: entry point not found",
      "BufferA: error[E99999]: entry point not found",
    ]);

    expect(result).toHaveLength(2);
  });

  it("still collapses an identical unlocated error repeated for one pass", () => {
    const result = dedupeCompilerErrors([
      "Image: error[E99999]: entry point not found",
      "Image: error[E99999]: entry point not found",
    ]);

    expect(result).toEqual(["Image: error[E99999]: entry point not found"]);
  });

  it("collapses repeated GLSL driver errors, whitespace differences included", () => {
    const glsl = "common: ERROR: 0:5: 'helper' : no matching overloaded function found";

    expect(dedupeCompilerErrors([glsl, `${glsl}   `])).toEqual([glsl]);
  });

  it("keeps GLSL errors on the same line of different passes apart", () => {
    const result = dedupeCompilerErrors([
      "Image: ERROR: 0:5: 'x' : undeclared identifier",
      "BufferA: ERROR: 0:5: 'y' : undeclared identifier",
    ]);

    expect(result).toHaveLength(2);
  });

  it("collapses repeated messages that carry no error heading at all", () => {
    const result = dedupeCompilerErrors([
      "Superseded by a newer compile",
      "Superseded by a newer compile",
      "WebGPU init failed: no adapter",
    ]);

    expect(result).toEqual(["Superseded by a newer compile", "WebGPU init failed: no adapter"]);
  });

  describe("Slang's terminal epilogue", () => {
    // The real payload for a stray `d` on line 14 of a shader.
    const cascade = [
      "Image: error[E20001]: unexpected token",
      "  --> /shadertoy.slang:15:12",
      "   |",
      "15 | float3 tun = col * sqs;",
      "   |        ^^^ unexpected identifier, expected ';'",
      "error[E30015]: undefined identifier",
      "  --> /shadertoy.slang:14:1",
      "   |",
      "14 | d",
      "   | ^ undefined identifier 'd'.",
      "error[E39999]: import failed due to compilation error",
      "fatal error[E40003]: compilation ceased",
      "abort compilation: fatal error[E40003]: compilation ceased",
    ].join("\n");

    it("drops the epilogue while keeping every located error", () => {
      const [result] = dedupeCompilerErrors([cascade]);

      expect(result).toContain("unexpected token");
      expect(result).toContain("undefined identifier 'd'");
      expect(result).not.toContain("import failed");
      expect(result).not.toContain("compilation ceased");
      expect(result).not.toContain("abort compilation");
    });

    it("keeps the pass prefix on whatever block leads after the drop", () => {
      const trailingPass = [
        "error[E39999]: import failed due to compilation error",
        "fatal error[E40003]: compilation ceased",
      ].join("\n");

      const result = dedupeCompilerErrors([
        "Image: error[E30015]: undefined identifier\n  --> /image.slang:4:9",
        `BufferA: ${trailingPass}`,
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toContain("image.slang:4:9");
    });

    it("keeps the epilogue when it is the only thing the compiler said", () => {
      const epilogue = [
        "Image: error[E39999]: import failed due to compilation error",
        "fatal error[E40003]: compilation ceased",
      ].join("\n");

      expect(dedupeCompilerErrors([epilogue])).toEqual([epilogue]);
    });

    it("keeps a GLSL compile alive as located, so its epilogue still goes", () => {
      const result = dedupeCompilerErrors([
        "Image: ERROR: 0:5: 'x' : undeclared identifier",
        "Image: error[E39999]: import failed due to compilation error",
      ]);

      expect(result).toEqual(["Image: ERROR: 0:5: 'x' : undeclared identifier"]);
    });

    it("keeps unlocated errors that are real findings, not epilogue", () => {
      const result = dedupeCompilerErrors([
        "Image: error[E30015]: undefined identifier\n  --> /image.slang:4:9",
        "Image: error[E99999]: entry point not found",
      ]);

      expect(result).toHaveLength(2);
      expect(result[1]).toContain("entry point not found");
    });
  });

  it("ignores non-string entries defensively", () => {
    const result = dedupeCompilerErrors([undefined as unknown as string, "Image: ERROR: 0:1: bad"]);

    expect(result).toEqual(["Image: ERROR: 0:1: bad"]);
  });
});

describe("splitCompilerErrorBlocks", () => {
  const first = [
    "Image: error[E20001]: unexpected token",
    "  --> /shadertoy.slang:15:12",
    "   |",
    "15 | float3 tun = col * sqs;",
    "   |        ^^^ unexpected identifier, expected ';'",
  ].join("\n");
  const second = [
    "error[E30015]: undefined identifier",
    "  --> /shadertoy.slang:14:1",
    "   |",
    "14 | d",
    "   | ^ undefined identifier 'd'.",
  ].join("\n");

  it("splits one batched payload into a block per diagnostic", () => {
    const blocks = splitCompilerErrorBlocks([`${first}\n${second}`]);

    expect(blocks.map((block) => block.text)).toEqual([first, second]);
  });

  it("reports the pass on the block that carries it", () => {
    const [leading, trailing] = splitCompilerErrorBlocks([`${first}\n${second}`]);

    expect(leading.pass).toBe("Image");
    expect(trailing.pass).toBeUndefined();
  });

  it("reports the location the compiler pointed at", () => {
    const [leading] = splitCompilerErrorBlocks([`${first}\n${second}`]);

    expect(leading.location).toEqual({ path: "/shadertoy.slang", line: 15, column: 12 });
  });

  it("leaves a block without a location unlocated", () => {
    const [block] = splitCompilerErrorBlocks(["Image: error[E99999]: entry point not found"]);

    expect(block.location).toBeUndefined();
    expect(block.pass).toBe("Image");
  });

  it("keeps a message with no error heading as a single block", () => {
    expect(splitCompilerErrorBlocks(["Superseded by a newer compile"]))
      .toEqual([{ text: "Superseded by a newer compile" }]);
  });

  it("flattens across payload entries and skips empty ones", () => {
    const blocks = splitCompilerErrorBlocks([first, "", "   ", second, undefined as unknown as string]);

    expect(blocks.map((block) => block.text)).toEqual([first, second]);
  });

  it("returns nothing for missing input", () => {
    expect(splitCompilerErrorBlocks(undefined)).toEqual([]);
    expect(splitCompilerErrorBlocks([])).toEqual([]);
  });
});

describe("firstReportedErrorLine", () => {
  it("finds the line a GLSL driver error names", () => {
    expect(firstReportedErrorLine(["Image: ERROR: 0:14: 'd' : undeclared identifier"])).toBe(14);
  });

  it("finds the line a Slang error names", () => {
    expect(firstReportedErrorLine([
      "Image: error[E20001]: unexpected token\n  --> /shader.slang:8:1",
    ])).toBe(8);
  });

  it("reports the earliest line when several are named", () => {
    expect(firstReportedErrorLine([
      "Image: ERROR: 0:20: 'x' : undeclared identifier",
      "Image: ERROR: 0:14: 'd' : undeclared identifier",
    ])).toBe(14);
  });

  it("returns null when the compiler named no line", () => {
    expect(firstReportedErrorLine(["Image: error[E99999]: entry point not found"])).toBeNull();
    expect(firstReportedErrorLine([])).toBeNull();
    expect(firstReportedErrorLine(undefined)).toBeNull();
  });
});
