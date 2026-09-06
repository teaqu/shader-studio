import * as vscode from "vscode";
import { DiagnosticArbiter } from "./app/DiagnosticArbiter";
import { VscodeLanguageServiceController } from "./language-services/VscodeLanguageServiceController";
import { createWebLanguageServiceFactories } from "./language-services/createWebLanguageServices";
import { registerCSpellDictionary } from "./language-services/CSpellIntegration";

/**
 * Browser entry point (`browser` in package.json) for the web extension host
 * used by vscode.dev and github.dev. It activates editing intelligence —
 * grammars, snippets, diagnostics, completion, hover — which is pure
 * TypeScript plus `vscode.workspace.fs`.
 *
 * The preview panel, local web server, git timestamps, and script bundling
 * stay desktop-only for now: they need Node.js (`fs`, `http`,
 * `child_process`, `vm`) or local sockets. Their commands are registered here
 * as explanatory stubs so the palette entries contributed in package.json say
 * what is happening instead of failing with "command not found".
 */
let languageServices: VscodeLanguageServiceController | undefined;

const DESKTOP_ONLY_COMMANDS = [
  "shader-studio.view",
  "shader-studio.viewInNewWindow",
  "shader-studio.startWebServer",
  "shader-studio.stopWebServer",
  "shader-studio.showWebServerMenu",
  "shader-studio.generateConfig",
  "shader-studio.newShader",
  "shader-studio.openShaderExplorer",
  "shader-studio.openSettings",
  "shader-studio.transpileGlslToJs",
  "shader-studio.toggleEditorOverlay",
  "shader-studio.toggleLock",
  "shader-studio.manualCompile",
  "shader-studio.resetLayout",
] as const;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Shader Studio", {
    log: true,
  });
  outputChannel.debug("Output channel initialized (web)");
  await registerCSpellDictionary(context);

  const diagnosticCollection = vscode.languages.createDiagnosticCollection(
    "shader-studio",
  );
  const glslServiceCollection = vscode.languages.createDiagnosticCollection(
    "shader-studio-glsl-ls",
  );
  const slangServiceCollection = vscode.languages.createDiagnosticCollection(
    "shader-studio-slang-ls",
  );
  context.subscriptions.push(diagnosticCollection, glslServiceCollection, slangServiceCollection);

  const diagnosticArbiter = new DiagnosticArbiter({
    compiler: diagnosticCollection,
    glsl: glslServiceCollection,
    slang: slangServiceCollection,
  });

  languageServices = new VscodeLanguageServiceController(
    createWebLanguageServiceFactories(context),
    undefined,
    {
      glsl: diagnosticArbiter.languageServiceSink("glsl"),
      slang: diagnosticArbiter.languageServiceSink("slang"),
    },
  );
  languageServices.start(context);

  // The enableSnippets rewrite of package.json needs Node `fs` and a
  // restartable host manifest, neither of which the web worker has, so web
  // keeps the statically contributed snippets. Same for the GLSL transpile
  // command, which shells through Node-only dependencies.
  for (const command of DESKTOP_ONLY_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        outputChannel.debug(`Desktop-only command invoked on web: ${command}`);
        void vscode.window.showInformationMessage(
          "This Shader Studio feature needs the desktop app and is unavailable in the web version.",
        );
      }),
    );
  }

  outputChannel.info("Shader Studio web extension activated successfully");
}

export function deactivate(): void {
  languageServices?.dispose();
  languageServices = undefined;
}
