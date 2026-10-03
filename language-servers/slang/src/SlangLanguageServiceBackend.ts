import { findSlangAuthoredDeclarations } from "@shader-studio/types";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  DiagnosticTag,
  MarkupKind,
  SymbolKind,
  type CompletionItem,
  type Diagnostic,
  type DocumentHighlight,
  DocumentHighlightKind,
  type DocumentSymbol,
  type Hover,
  type Location,
  type MarkupContent,
  type Position,
  type Range,
  type SignatureHelp,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import {
  DocumentStore,
  VirtualFileSystem,
  createLiteralColorPresentations,
  declarationContext,
  findLiteralConstructorColors,
  findMemberAccess,
  isInsideBlock,
  isPositionInComment,
  rankCompletionsForContext,
  swizzleCompletions,
  memberSelectionAt,
  type ColorPresentationParams,
  type DocumentParams,
  type DocumentPositionParams,
  type LanguageService,
  type RenameParams,
  type ReferenceParams,
  type ServerCapabilities,
  type ShaderDocumentSnapshot,
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  buildSlangAuthoringModule,
  describeSlangChannel,
  isValidShaderIdentifier,
  validateShaderAuthoringEnvironment,
  type AuthoringResource,
  type ShaderAuthoringEnvironment,
  isShaderEntryPointName,
  isShaderTypeKeyword,
  shaderTypeCompletionKeywords,
} from "@shader-studio/types";
import type {
  SlangDiagnostic,
  SlangCompilerGlobalSession,
  SlangDocumentSymbol,
  SlangLanguageServer,
  SlangLanguageServerModule,
  SlangList,
} from "./slangLanguageServerTypes.js";
import { SLANG_INTRINSICS, type SlangIntrinsic } from "./intrinsics.js";
import { SLANG_COMPUTE_FEATURES, type SlangComputeFeature } from "./computeFeatures.js";
import { SLANG_VERTEX_HOOK_FEATURES, type SlangVertexHookFeature } from "./vertexHook.js";
import { SLANG_MAIN_IMAGE_COORDINATE_DESCRIPTION, SLANG_MAIN_IMAGE_DESCRIPTION } from "./fragmentHook.js";
import { findSlangLocalAt, findUnusedSlangLocals, resolveSlangExpressionType, visibleSlangLocals, type SlangExpressionContext } from "./expressionType.js";
import { SLANG_SWIZZLE_SETS, resolveSlangSwizzleType, slangVectorTypeName } from "./slangTypes.js";
import { applySlangRenameEdits, renameSlangSymbol, resolveSlangSymbol, type SlangRenameDocument } from "./rename.js";

import { contextualFiles, computeFeatureMarkup, vertexHookMarkup, contractMarkup, mainImageMarkup, mainImageFeatureAt, mainImageCompletionFeature, mainImageCoordinateCompletion, offsetAtPosition, matchingBrace, vertexHookFeatureAt, vertexHookCompletionFeatures, vertexHookMatches, consumeList, convertDocumentSymbol, convertDiagnostic, shiftedPosition, shiftedRange, userRange, zeroRange, comparePositions, rangesOverlap, consumeCompilerTargets, INCLUDE_STRING_PATTERN, INCLUDE_IDENT_PATTERN, IMPORT_PATTERN, MODULE_DECL_PATTERN, IMPLEMENTING_DECL_PATTERN, resolveCompilerDependencies, sourcePath, moduleName, parseCompilerDiagnostics, slangType, markup, localSourceHover, currentDocumentDefinitionLine, generatedLocalDefinitionLine, escapeRegExp, wordAt, memberCompletions, slangExpressionContext, memberHover, moduleDirectiveHover, completionDocumentation, shaderStudioInputMemberCompletions, inputMethodCompletion, isGeneratedInputImplementationSymbol, shaderStudioInputMethodSignaturesAtCall, nativeTextureMemberCompletions, nativeTextureMember, generatedEnvironmentGlobals, generatedSamplingFunctions, slangStorageBufferType, slangStorageElementType, environmentTypeName, intrinsicReturnType, declaresSlangType, findSlangDeclarations, authoredChannelCollisionDiagnostics, offsetRange, positionAtOffset, authoredPointRange, nativeDefinitionKey, identifierOccurrences, SLANG_CALL_KEYWORDS, callAt, documentedSlangFunctions, intrinsic, completionForIntrinsic, intrinsicMarkup } from "./SlangLanguageServiceSupport.js";
import type { SlangMainImageFeature, SlangVertexHookMatch, SlangDeclaration } from "./SlangLanguageServiceSupport.js";
const CAPABILITIES: ServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  signatureHelp: true,
  documentSymbols: true,
  diagnostics: true,
  documentColors: true,
  // The bundled Slang language server exposes no reference index. Rename uses
  // a separate strict scoped analysis; navigation still uses the native API.
  references: true,
  documentHighlights: true,
  rename: true,
};

export class SlangLanguageServiceBackend {
  readonly store = new DocumentStore();
  readonly server: SlangLanguageServer;
  private readonly lineOffsets = new Map<string, number>();
  private readonly opened = new Set<string>();
  private readonly virtualOpened = new Set<string>();
  private compilerGlobalSession: SlangCompilerGlobalSession | undefined;
  private compilerTarget: number | undefined;

  constructor(private readonly module: SlangLanguageServerModule) {
    const server = module.createLanguageServer();
    if (!server) {
      throw new Error("Slang createLanguageServer returned null");
    }
    this.server = server;
  }

  async initialize(): Promise<ServerCapabilities> {
    return CAPABILITIES;
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (environment.languageId !== "slang" || !this.store.syncEnvironment(environment)) {
      return;
    }
    for (const file of contextualFiles(environment)) {
      if (this.virtualOpened.has(file.uri)) {
        this.server.didCloseTextDocument(file.uri);
      }
      this.server.didOpenTextDocument(file.uri, file.text);
      this.virtualOpened.add(file.uri);
    }
    this.reopen(environment.documentUri);
  }

  async openDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "slang" || !this.store.open(document)) {
      return;
    }
    this.reopen(document.uri);
  }

  async changeDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "slang" || !this.store.change(document)) {
      return;
    }
    this.reopen(document.uri);
  }

  async closeDocument(uri: string): Promise<void> {
    if (this.opened.delete(uri)) {
      this.server.didCloseTextDocument(uri);
    }
    this.lineOffsets.delete(uri);
    this.store.close(uri);
  }

  async documentColors(params: DocumentParams) {
    const state = this.current(params);
    return state ? findLiteralConstructorColors(state.document.text, ["float3", "float4"]) : [];
  }

  async colorPresentations(params: ColorPresentationParams) {
    if (!this.store.isCurrent(params.document)) {
      return [];
    }
    return createLiteralColorPresentations("slang", params.color, params.range, this.store.getDocument(params.document.uri)?.text);
  }

  async dispose(): Promise<void> {
    for (const uri of this.opened) {
      this.server.didCloseTextDocument(uri);
    }
    for (const uri of this.virtualOpened) {
      this.server.didCloseTextDocument(uri);
    }
    this.opened.clear();
    this.virtualOpened.clear();
    this.compilerGlobalSession?.delete?.();
    this.compilerGlobalSession = undefined;
    this.compilerTarget = undefined;
    this.server.delete?.();
  }

  private reopen(uri: string): void {
    const document = this.store.getDocument(uri);
    const environment = this.store.getEnvironment(uri);
    if (!document || !environment) {
      return;
    }
    if (this.opened.has(uri)) {
      this.server.didCloseTextDocument(uri);
    }
    const prelude = buildSlangAuthoringModule(environment).text;
    const commonSource = environment.commonFile
      ? resolveCompilerDependencies(
        environment.commonFile.text,
        environment.commonFile.uri,
        environment.virtualFiles,
      )
      : "";
    const prefix = [prelude, commonSource].filter(Boolean).join("\n");
    const offset = prefix ? prefix.split("\n").length : 0;
    this.lineOffsets.set(uri, offset);
    this.server.didOpenTextDocument(uri, prefix ? `${prefix}\n${document.text}` : document.text);
    this.opened.add(uri);
  }

  current(params: DocumentParams) {
    if (!this.store.isCurrent(params.document)) {
      return undefined;
    }
    const document = this.store.getDocument(params.document.uri);
    const environment = this.store.getEnvironment(params.document.uri);
    const offset = this.lineOffsets.get(params.document.uri);
    return document && environment && offset !== undefined ? { document, environment, offset } : undefined;
  }

  /**
   * Warns about Slang locals and parameters nothing reads, recovered from
   * source text because the bundled server exposes no reference index.
   * Reports overlapping an official diagnostic are left to the official one
   * so the same span is never squiggled twice.
   */
  unusedLocalDiagnostics(
    state: NonNullable<ReturnType<SlangLanguageServiceBackend["current"]>>,
    official: readonly Diagnostic[],
  ): Diagnostic[] {
    return findUnusedSlangLocals(state.document.text)
      .filter((local) => !official.some((diagnostic) => rangesOverlap(diagnostic.range, local.range)))
      .map((local): Diagnostic => ({
        range: local.range,
        // Hint, not Warning: the Unnecessary tag already greys the symbol,
        // and an unused local needs no squiggle.
        severity: DiagnosticSeverity.Hint,
        source: "shader-studio-slang-ls",
        code: local.kind === "parameter" ? "unused-parameter" : "unused-variable",
        message: `Unused ${local.kind} '${local.name}'.`,
        tags: [DiagnosticTag.Unnecessary],
      }));
  }

  compilerDiagnostics(state: NonNullable<ReturnType<SlangLanguageServiceBackend["current"]>>): Diagnostic[] {
    const compiler = this.compiler();
    if (!compiler) {
      return [];
    }
    const session = compiler.globalSession.createSession(compiler.target);
    if (!session) {
      return [];
    }
    try {
      const prelude = buildSlangAuthoringModule(state.environment).text;
      const commonSource = state.environment.commonFile
        ? resolveCompilerDependencies(
          state.environment.commonFile.text,
          state.environment.commonFile.uri,
          state.environment.virtualFiles,
        )
        : "";
      const authoredSource = resolveCompilerDependencies(
        state.document.text,
        state.document.uri,
        state.environment.virtualFiles,
      );
      const prefix = [prelude, commonSource].filter(Boolean).join("\n");
      const source = prefix ? `${prefix}\n${authoredSource}` : authoredSource;
      const offset = prefix ? prefix.split("\n").length : 0;
      const compiled = session.loadModuleFromSource(source, moduleName(state.document.text, state.document.uri), sourcePath(state.document.uri));
      if (compiled) {
        compiled.delete?.();
        return [];
      }
      return parseCompilerDiagnostics(this.module.getLastError?.().message ?? "", sourcePath(state.document.uri), offset, state.document.text);
    } finally {
      session.delete?.();
    }
  }

  compiler(): { globalSession: SlangCompilerGlobalSession; target: number } | undefined {
    if (this.compilerGlobalSession && this.compilerTarget !== undefined) {
      return { globalSession: this.compilerGlobalSession, target: this.compilerTarget };
    }
    if (!this.module.createGlobalSession || !this.module.getCompileTargets) {
      return undefined;
    }
    const globalSession = this.module.createGlobalSession();
    if (!globalSession) {
      return undefined;
    }
    const targets = consumeCompilerTargets(this.module.getCompileTargets());
    const target = targets.find((item) => /wgsl/i.test(item.name))?.value;
    if (target === undefined) {
      globalSession.delete?.();
      return undefined;
    }
    this.compilerGlobalSession = globalSession;
    this.compilerTarget = target;
    return { globalSession, target };
  }

  /** Use Slang's own declaration identity for syntax our GLSL-compatible
   * fallback cannot model (generic specializations, methods, and imports). */
  nativeRename(documents: readonly SlangRenameDocument[], params: RenameParams): WorkspaceEdit | null {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.newName)) {
      return null;
    }
    const state = this.current(params);
    if (!state || isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const target = nativeDefinitionKey(this.server, params.document.uri, shiftedPosition(params.position, state.offset));
    if (!target || target.startsWith("shader-studio:")) {
      return null;
    }
    const changes: Record<string, TextEdit[]> = {};
    for (const document of documents) {
      const offset = this.lineOffsets.get(document.uri) ?? 0;
      for (const occurrence of identifierOccurrences(document.text)) {
        if (occurrence.name !== wordAt(document.text, params.position) && document.uri === params.document.uri) {
          continue;
        }
        const identity = nativeDefinitionKey(this.server, document.uri, shiftedPosition(occurrence.position, offset));
        if (identity !== target) {
          continue;
        }
        (changes[document.uri] ??= []).push({ range: occurrence.range, newText: params.newName });
      }
    }
    return Object.keys(changes).length ? { changes } : null;
  }

  renameDocuments(): SlangRenameDocument[] {
    const documents = [...this.opened].flatMap(uri => {
      const document = this.store.getDocument(uri);
      const environment = this.store.getEnvironment(uri);
      return document && environment ? [{ uri, text: document.text, environment }] : [];
    });
    for (const item of [...documents]) {
      const workspaceDocuments = item.environment.workspaceDocuments ?? [];
      for (const workspace of workspaceDocuments) {
        if (documents.some(document => document.uri === workspace.uri)) {
          continue;
        }
        const common = workspaceDocuments.find(file => file.uri === workspace.commonUri);
        documents.push({
          uri: workspace.uri,
          text: workspace.text,
          environment: { ...item.environment, documentUri: workspace.uri, stage: workspace.stage,
            passName: workspaceDocuments.some(file => file.commonUri === workspace.uri) ? 'Common' : 'Image',
            commonFile: common,
          },
        });
      }
    }
    // Opened documents carry the store environment, which never sets
    // top-level commonFile at the host (only workspace entries link by
    // commonUri). Without this backfill the active pass cannot see its
    // Common, so renameSlangSymbol falls back to the pass URI and drops
    // every cross-file document.
    for (let index = 0; index < documents.length; index++) {
      const document = documents[index]!;
      if (document.environment.commonFile) {
        continue;
      }
      const workspaceDocuments = document.environment.workspaceDocuments ?? [];
      const commonUri = workspaceDocuments.find(file => file.uri === document.uri)?.commonUri;
      const common = commonUri ? workspaceDocuments.find(file => file.uri === commonUri) : undefined;
      if (common) {
        documents[index] = { ...document, environment: { ...document.environment, commonFile: common } };
      }
    }
    // Every editor in the host shares one service, so a second editor can
    // sync the Common file as its own document while still carrying the pass
    // context: its commonFile then points at itself. A document is never its
    // own Common — without this renameCompiles concatenates the Common source
    // twice and vetoes a correct cross-file edit.
    return documents.map(document => document.environment.commonFile?.uri === document.uri
      ? { ...document, environment: { ...document.environment, commonFile: undefined } }
      : document);
  }

  documentText(uri: string): string | undefined {
    return this.store.getDocument(uri)?.text
      ?? [...this.opened].map(openUri => this.store.getEnvironment(openUri)?.commonFile).find(file => file?.uri === uri)?.text
      ?? this.renameDocuments().find(document => document.uri === uri)?.text;
  }

  renameCompiles(documents: readonly SlangRenameDocument[], edit: WorkspaceEdit): boolean {
    try {
      const compiler = this.compiler();
      if (!compiler || !edit.changes) {
        return false;
      }
      // Validate in separate compiler sessions; never modify the language server's
      // open buffers while the editor is still deciding whether to apply an edit.
      for (const document of documents) {
        const common = document.environment.commonFile;
        if (!edit.changes[document.uri] && !(common && edit.changes[common.uri])) {
          continue;
        }
        const session = compiler.globalSession.createSession(compiler.target);
        if (!session) {
          return false;
        }
        try {
          const commonText = common ? documents.find(item => item.uri === common.uri)?.text ?? common.text : "";
          const commonSource = common ? resolveCompilerDependencies(
            applySlangRenameEdits(commonText, edit.changes[common.uri] ?? []), common.uri, document.environment.virtualFiles,
          ) : "";
          const authoredSource = resolveCompilerDependencies(
            applySlangRenameEdits(document.text, edit.changes[document.uri] ?? []), document.uri, document.environment.virtualFiles,
          );
          const prefix = buildSlangAuthoringModule(document.environment).text;
          const source = [prefix, commonSource, authoredSource].filter(Boolean).join("\n");
          const compiled = session.loadModuleFromSource(source, moduleName(document.text, document.uri), sourcePath(document.uri));
          if (!compiled) {
            return false;
          }
          compiled.delete?.();
        } finally {
          session.delete?.();
        }
      }
      return true;
    } catch {
      return false;
    }
  }

}
