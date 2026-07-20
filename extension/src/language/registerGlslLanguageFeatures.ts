import * as vscode from "vscode";
import { GlslParser, findSymbol, getSymbolTable, type GlslSymbolTable } from "@shader-studio/glsl-debug";

export const GLSL_DOCUMENT_SELECTOR: vscode.DocumentSelector = [{ language: "glsl", scheme: "file" }];

// Uniforms and outputs injected by rendering/src/webgl/ShaderCompiler.ts —
// they have no declaration in user source, so goto-def must not fall through
// to a same-named symbol in another pass file.
const INJECTED_NAMES = new Set([
  "iResolution", "iTime", "iTimeDelta", "iFrameRate", "iMouse", "iFrame",
  "iDate", "iChannelTime", "iSampleRate", "iCameraPos", "iCameraDir",
  "iCh0", "iCh1", "iCh2", "iCh3", "iChannelResolution", "fragColor",
  ...Array.from({ length: 10 }, (_, index) => `iChannel${index}`),
]);

interface GlslShaderConfig {
  shaderPath: string;
  bufferPathMap?: Record<string, string>;
}

let shaderConfig: GlslShaderConfig | null = null;

export function setGlslShaderConfig(config: GlslShaderConfig | null): void {
  shaderConfig = config;
}

const tableCache = new Map<string, { version: number; table: GlslSymbolTable }>();

function symbolTableFor(document: vscode.TextDocument): GlslSymbolTable {
  const key = document.uri.toString();
  const cached = tableCache.get(key);
  if (cached && cached.version === document.version) {
    return cached.table;
  }
  const table = getSymbolTable(document.getText().split("\n"));
  tableCache.set(key, { version: document.version, table });
  return table;
}

export class GlslDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location | undefined> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }
    const word = document.getText(wordRange);
    if (INJECTED_NAMES.has(word)) {
      return undefined;
    }

    const lines = document.getText().split("\n");
    const localLine = GlslParser.getDeclarationLines(lines, position.line).get(word);
    if (localLine !== undefined && localLine !== position.line) {
      const column = Math.max(0, lines[localLine]?.indexOf(word) ?? 0);
      return new vscode.Location(document.uri, new vscode.Position(localLine, column));
    }

    const own = findSymbol(symbolTableFor(document), word);
    if (own) {
      return new vscode.Location(document.uri, new vscode.Position(own.line, own.column));
    }

    for (const passPath of Object.values(shaderConfig?.bufferPathMap ?? {})) {
      const passUri = vscode.Uri.file(passPath);
      if (passUri.fsPath === document.uri.fsPath) {
        continue;
      }
      let passDocument: vscode.TextDocument;
      try {
        passDocument = await vscode.workspace.openTextDocument(passUri);
      } catch {
        continue;
      }
      const symbol = findSymbol(symbolTableFor(passDocument), word);
      if (symbol) {
        return new vscode.Location(passUri, new vscode.Position(symbol.line, symbol.column));
      }
    }
    return undefined;
  }
}

const activeRegistrations = new WeakMap<vscode.ExtensionContext, vscode.Disposable>();

export function registerGlslLanguageFeatures(context: vscode.ExtensionContext): vscode.Disposable {
  const existing = activeRegistrations.get(context);
  if (existing) {
    return existing;
  }
  let provider: vscode.Disposable | undefined;
  const update = (): void => {
    const enabled = vscode.workspace.getConfiguration("shader-studio").get("glslLanguageFeatures", true);
    if (enabled && !provider) {
      provider = vscode.languages.registerDefinitionProvider(GLSL_DOCUMENT_SELECTOR, new GlslDefinitionProvider());
    } else if (!enabled && provider) {
      provider.dispose();
      provider = undefined;
    }
  };
  update();
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("shader-studio.glslLanguageFeatures")) {
      update();
    }
  });
  const registration = new vscode.Disposable(() => {
    configuration.dispose();
    provider?.dispose?.();
    provider = undefined;
    tableCache.clear();
    activeRegistrations.delete(context);
  });
  activeRegistrations.set(context, registration);
  context.subscriptions.push(configuration, registration);
  return registration;
}
