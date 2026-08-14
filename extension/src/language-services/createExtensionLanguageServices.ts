import { readFileSync } from "fs";
import { pathToFileURL } from "url";
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
      // Keep Emscripten's ESM runtime external to the CommonJS extension bundle:
      // it uses import.meta.url when creating its Node require function.
      const runtimeUrl = pathToFileURL(context.asAbsolutePath("dist/slang-wasm.mjs")).href;
      const runtime = await import(runtimeUrl) as {
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
