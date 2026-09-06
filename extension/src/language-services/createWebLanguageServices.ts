import * as vscode from "vscode";
import type { LanguageService, ServerCapabilities } from "@shader-studio/language-server-core";
import type { ShaderLanguage } from "@shader-studio/language-server-core";

/**
 * Language-service factories for the browser extension host
 * (vscode.dev, github.dev). Node.js builtins (`fs`, `path`, `child_process`,
 * `http`, `vm`) do not exist in the web worker, so this module must stay free
 * of them — the browser esbuild build fails if any creep back in.
 *
 * GLSL runs fully: the analyser is pure TypeScript. Slang loads the same
 * Emscripten runtime (`dist/slang-wasm.mjs`) and WASM bytes
 * (`ui-dist/slang-assets.json` manifest) as the desktop loader, but through
 * extension-URI-safe APIs: the manifest and WASM bytes come from
 * `vscode.workspace.fs`, and the runtime is dynamically imported from the
 * extension's own `dist/` folder. If any of that fails (e.g. assets missing
 * from the web package), Slang falls back to the placeholder service that
 * answers every request empty instead of rejecting. The controller caches
 * factory results, so a rejecting factory would poison Slang for the whole
 * session.
 */
export function createWebLanguageServiceFactories(
  context: vscode.ExtensionContext,
): Record<ShaderLanguage, () => Promise<LanguageService>> {
  return {
    glsl: async () => {
      const { GlslLanguageService } = await import("@shader-studio/glsl-language-server");
      return new GlslLanguageService();
    },
    slang: async () => {
      try {
        return await createWebSlangLanguageService(context);
      } catch {
        return new UnavailableLanguageService();
      }
    },
  };
}

const textDecoder = new TextDecoder();

async function createWebSlangLanguageService(
  context: vscode.ExtensionContext,
): Promise<LanguageService> {
  const { SlangLanguageService } = await import("@shader-studio/slang-language-server");
  const manifestBytes = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(context.extensionUri, "ui-dist", "slang-assets.json"),
  );
  const assetManifest = JSON.parse(textDecoder.decode(manifestBytes)) as { wasm?: unknown };
  if (typeof assetManifest.wasm !== "string" || !/^assets\/[^/]+\.wasm$/.test(assetManifest.wasm)) {
    throw new Error("Shader Studio Slang asset manifest does not contain a valid WASM path");
  }
  const wasmBinary = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(context.extensionUri, "ui-dist", assetManifest.wasm),
  );
  // Keep Emscripten's ESM runtime external to the browser bundle (as on
  // desktop): it is served from the extension's dist/ folder and imported
  // through its extension URI, which the web worker resolves.
  const runtimeUri = vscode.Uri.joinPath(context.extensionUri, "dist", "slang-wasm.mjs").toString();
  const runtime = (await import(runtimeUri)) as {
    default(options: { wasmBinary: Uint8Array }): Promise<unknown>;
  };
  const module = await runtime.default({ wasmBinary });
  return new SlangLanguageService(module as ConstructorParameters<typeof SlangLanguageService>[0]);
}

/** Fallback when the Slang WASM runtime cannot load in the browser worker. */
export class UnavailableLanguageService implements LanguageService {
  async initialize(): Promise<ServerCapabilities> {
    return {
      completion: false,
      hover: false,
      definition: false,
      signatureHelp: false,
      documentSymbols: false,
      diagnostics: false,
      documentColors: false,
      references: false,
      documentHighlights: false,
      rename: false,
    };
  }

  async syncEnvironment(): Promise<void> {
    // No environment to sync without the compiler.
  }

  async openDocument(): Promise<void> {
    // Accepted and ignored: nothing analyses the document yet.
  }

  async changeDocument(): Promise<void> {
    // Accepted and ignored: nothing analyses the document yet.
  }

  async closeDocument(): Promise<void> {
    // Nothing was opened.
  }

  async completion(): Promise<[]> {
    return [];
  }

  async hover(): Promise<null> {
    return null;
  }

  async definition(): Promise<[]> {
    return [];
  }

  async signatureHelp(): Promise<null> {
    return null;
  }

  async documentSymbols(): Promise<[]> {
    return [];
  }

  async references(): Promise<[]> {
    return [];
  }

  async documentHighlights(): Promise<[]> {
    return [];
  }

  async rename(): Promise<null> {
    return null;
  }

  async diagnostics(): Promise<[]> {
    return [];
  }

  async documentColors(): Promise<[]> {
    return [];
  }

  async colorPresentations(): Promise<[]> {
    return [];
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }
}
