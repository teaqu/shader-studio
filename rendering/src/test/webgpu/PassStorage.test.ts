import { describe, expect, it } from "vitest";
import { resolvePassStorage } from "../../webgpu/PassStorage";
import type { StorageBindingNode } from "../../types/PassGraph";

const storage: StorageBindingNode[] = ["ram", "uart", "unused"].map((name, binding) => ({
  name, binding, elementType: "uint", builtin: true, count: 4, stride: 4,
}));

describe("resolvePassStorage", () => {
  it("matches whole identifiers, ignores trivia and preserves config order with dense bindings", () => {
    expect(resolvePassStorage(storage, `
      // ram[0]
      /* unused */
      const char* text = "ram";
      const char c = 'x';
      uint ramSize = 4;
      helper(uart);
    `)).toEqual([{ ...storage[1], binding: 0 }]);
    expect(storage[1].binding).toBe(1);
  });

  it("includes resources referenced by common and imported module helpers", () => {
    expect(resolvePassStorage(storage, "main();", "uint read() { return uart[0]; }", "ram[0] = 1;"))
      .toEqual(storage.slice(0, 2));
  });

  it("retains macro and conditional references conservatively", () => {
    expect(resolvePassStorage(storage, "#define DATA uart\n#if CUSTOM\nram[0] = DATA[0];\n#endif"))
      .toEqual(storage.slice(0, 2));
  });

  it("retains all declarations when token pasting can manufacture names", () => {
    expect(resolvePassStorage(storage, "#define JOIN(a,b) a ## b")).toEqual(storage);
  });

  it("returns no bindings without references or declarations", () => {
    expect(resolvePassStorage(storage)).toEqual([]);
    expect(resolvePassStorage([], "ram[0]")).toEqual([]);
  });
  it("handles nested WGSL comments, comment quotes, and unterminated trivia", () => {
    expect(resolvePassStorage(storage, '/* " /* unused */ uart */ ram[0]')).toEqual([storage[0]]);
    expect(resolvePassStorage(storage, "// uart")).toEqual([]);
    expect(resolvePassStorage(storage, "/* uart")).toEqual([]);
    expect(resolvePassStorage(storage, '"uart')).toEqual([]);
  });

  it("ignores escaped quotes and token pasting inside strings", () => {
    expect(resolvePassStorage(storage, String.raw`"a\" uart ##" ram[0]`)).toEqual([storage[0]]);
    expect(resolvePassStorage(storage, "'u' uart[0]")).toEqual([{ ...storage[1], binding: 0 }]);
  });

  it("retains config-owned struct declarations when the pass uses the type", () => {
    const typed = { ...storage[1], elementType: "Particle", structDeclarations: { slang: "struct Particle {};", wgsl: "struct Particle {}" } };
    expect(resolvePassStorage([storage[0], typed], "Particle p;"))
      .toEqual([{ ...typed, binding: 0 }]);
    expect(resolvePassStorage([typed], "return 0;")).toEqual([]);
  });

});
