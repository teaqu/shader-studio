// @vitest-environment node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

const bundledSlangModuleUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url);
const hasBundledSlangWasm = existsSync(fileURLToPath(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url)));

// The loaded slang-wasm module is shared by every engine in a webview. Each
// engine builds its own SlangCompiler, so compilers come and go many times.
describe.runIf(hasBundledSlangWasm)("SlangCompiler reuse of one slang-wasm module", { timeout: 120_000 }, () => {
  let slang: SlangModuleApi;

  beforeAll(async () => {
    const runtime = await import(/* @vite-ignore */ bundledSlangModuleUrl.href) as { default: () => Promise<SlangModuleApi> };
    slang = await runtime.default();
  }, 30_000);

  it("keeps compiling after many compilers are created and disposed", () => {
    const failures: string[] = [];
    for (let index = 0; index < 30; index++) {
      const compiler = new SlangCompiler(slang);
      const result = compiler.compileImagePass("float4 mainImage(float2 c) { return float4(c, 0, 1); }");
      if (!result.success) {
        failures.push(`compiler ${index}: ${result.errors.join(" | ")}`);
      }
      compiler.dispose();
    }

    expect(failures).toEqual([]);
  });
});
