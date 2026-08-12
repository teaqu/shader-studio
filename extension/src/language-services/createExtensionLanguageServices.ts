import { readFileSync } from "fs";
import * as vscode from "vscode";
import type { LanguageService, ShaderLanguage } from "@shader-studio/language-server-core";

export function createExtensionLanguageServiceFactories(
  context: vscode.ExtensionContext,
): Record<ShaderLanguage, () => Promise<LanguageService>> {
  return {
    glsl: async () => {
      const { GlslLanguageService } = await import("@shader-studio/glsl-language-server");
      return new GlslLanguageService();
    },
    slang: async () => {
      const { SlangLanguageService } = await import("@shader-studio/slang-language-server");
      // The generated Emscripten JavaScript is paired with interface.d.ts but TypeScript
      // does not associate that sibling declaration across this package boundary.
      // @ts-expect-error generated Slang module has no directly resolvable declaration here
      const runtime = await import("../../../ui/src/slang/slang-wasm.js") as {
        default(options: { wasmBinary: Uint8Array }): Promise<unknown>;
      };
      const assetManifest = JSON.parse(readFileSync(context.asAbsolutePath("ui-dist/slang-assets.json"), "utf8")) as { wasm?: unknown };
      if (typeof assetManifest.wasm !== "string" || !/^assets\/[^/]+\.wasm$/.test(assetManifest.wasm)) {
        throw new Error("Shader Studio Slang asset manifest does not contain a valid WASM path");
      }
      const wasmBinary = readFileSync(context.asAbsolutePath(`ui-dist/${assetManifest.wasm}`));
      const module = await runtime.default({ wasmBinary });
      return new SlangLanguageService(module as ConstructorParameters<typeof SlangLanguageService>[0]);
    },
  };
}
