import * as vscode from "vscode";
import { GlslFileTracker, isGlslDocument } from "./GlslFileTracker";
import { ShaderProvider } from "./ShaderProvider";
import { Messenger } from "./transport/Messenger";
import type { ErrorMessage } from "@shader-studio/types";

export type CompileMode = "hot" | "save" | "manual";

export class CompileController {
  private compileMode: CompileMode;
  private lastActiveGlslPath: string | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private glslFileTracker: GlslFileTracker,
    private shaderProvider: ShaderProvider,
    private messenger: Messenger,
  ) {
    this.compileMode = this.getStoredCompileMode();
  }

  public getMode(): CompileMode {
    return this.compileMode;
  }

  public setMode(mode: CompileMode): void {
    if (mode !== "hot" && mode !== "save" && mode !== "manual") {
      return;
    }

    this.compileMode = mode;
    void this.context.globalState.update("shader-studio.compileMode", mode);
  }

  public handleActiveEditorChange(
    editor: vscode.TextEditor | undefined,
  ): void {
    if (!editor || !this.glslFileTracker.isGlslEditor(editor)) {
      return;
    }

    const shaderPath = editor.document.uri.fsPath;
    const switchedShader =
      this.lastActiveGlslPath === null || this.lastActiveGlslPath !== shaderPath;

    this.glslFileTracker.setLastViewedGlslFile(shaderPath);

    if (this.compileMode === "hot" || switchedShader) {
      this.performShaderUpdate(editor);
    }

    this.lastActiveGlslPath = shaderPath;
  }

  public handleTextDocumentChange(
    event: vscode.TextDocumentChangeEvent,
  ): void {
    if (isGlslDocument(event.document)) {
      this.glslFileTracker.setLastViewedGlslFile(event.document.uri.fsPath);
      if (this.compileMode === "hot") {
        this.performShaderDocumentUpdate(event.document);
      }
      return;
    }

    if (this.compileMode === "hot" && this.isScriptFile(event.document)) {
      this.handleScriptDocumentChange(event.document);
    }
  }

  public handleTextDocumentSave(
    document: vscode.TextDocument,
    visibleTextEditors: readonly vscode.TextEditor[],
  ): void {
    if (this.compileMode !== "save") {
      return;
    }

    if (isGlslDocument(document)) {
      this.glslFileTracker.setLastViewedGlslFile(document.uri.fsPath);
      const visibleEditor = visibleTextEditors.find(
        (editor) => editor.document.uri.fsPath === document.uri.fsPath,
      );

      if (visibleEditor && this.glslFileTracker.isGlslEditor(visibleEditor)) {
        this.performShaderUpdate(visibleEditor);
      } else if (this.messenger.hasActiveClients()) {
        void this.shaderProvider.sendShaderFromPath(document.uri.fsPath);
      }
      return;
    }

    if (this.isScriptFile(document)) {
      this.handleScriptDocumentChange(document);
    }
  }

  public async manualCompileCurrentShader(
    activeEditor: vscode.TextEditor | undefined,
  ): Promise<void> {
    if (this.compileMode !== "manual") {
      return;
    }

    const targetEditor = activeEditor && this.glslFileTracker.isGlslEditor(activeEditor)
      ? activeEditor
      : this.glslFileTracker.getActiveOrLastViewedGLSLEditor() ?? undefined;

    if (targetEditor && this.glslFileTracker.isGlslEditor(targetEditor)) {
      this.glslFileTracker.setLastViewedGlslFile(targetEditor.document.uri.fsPath);
      await this.shaderProvider.sendShaderFromEditor(targetEditor);
      return;
    }

    const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
    if (lastViewedFile) {
      await this.shaderProvider.sendShaderFromPath(lastViewedFile);
      return;
    }

    const errorMsg: ErrorMessage = {
      type: "error",
      payload: ["No GLSL file to compile. Open a .glsl file first."],
    };
    this.messenger.send(errorMsg);
  }

  private getStoredCompileMode(): CompileMode {
    const stored = this.context.globalState.get<string>("shader-studio.compileMode");
    return stored === "save" || stored === "manual" ? stored : "hot";
  }

  private performShaderUpdate(editor: vscode.TextEditor): void {
    if (this.messenger.hasActiveClients()) {
      void this.shaderProvider.sendShaderFromEditor(editor);
    }
  }

  private performShaderDocumentUpdate(document: vscode.TextDocument): void {
    if (this.messenger.hasActiveClients()) {
      void this.shaderProvider.sendShaderFromDocument(document);
    }
  }

  private handleScriptDocumentChange(document: vscode.TextDocument): void {
    const lastViewedFile = this.glslFileTracker.getLastViewedGlslFile();
    if (!lastViewedFile) {
      return;
    }

    const scriptPath = document.uri.fsPath;
    const config = this.shaderProvider.getActiveConfig(lastViewedFile);
    const resolvedScript = this.shaderProvider.getScriptPath(config, lastViewedFile);
    if (!resolvedScript || resolvedScript !== scriptPath) {
      return;
    }

    void this.shaderProvider.sendShaderWithScriptContent(
      lastViewedFile,
      document.getText(),
    );
  }

  private isScriptFile(document: vscode.TextDocument): boolean {
    return document.fileName.endsWith(".js")
      || document.fileName.endsWith(".ts")
      || document.fileName.endsWith(".mjs");
  }
}
