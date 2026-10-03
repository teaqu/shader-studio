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
} from "../slangLanguageServerTypes.js";
import { SLANG_INTRINSICS, type SlangIntrinsic } from "../intrinsics.js";
import { SLANG_COMPUTE_FEATURES, type SlangComputeFeature } from "../computeFeatures.js";
import { SLANG_VERTEX_HOOK_FEATURES, type SlangVertexHookFeature } from "../vertexHook.js";
import { SLANG_MAIN_IMAGE_COORDINATE_DESCRIPTION, SLANG_MAIN_IMAGE_DESCRIPTION } from "../fragmentHook.js";
import { findSlangLocalAt, findUnusedSlangLocals, resolveSlangExpressionType, visibleSlangLocals, type SlangExpressionContext } from "../expressionType.js";
import { SLANG_SWIZZLE_SETS, resolveSlangSwizzleType, slangVectorTypeName } from "../slangTypes.js";
import { applySlangRenameEdits, renameSlangSymbol, resolveSlangSymbol, type SlangRenameDocument } from "../rename.js";

import { contextualFiles, computeFeatureMarkup, vertexHookMarkup, contractMarkup, mainImageMarkup, mainImageFeatureAt, mainImageCompletionFeature, mainImageCoordinateCompletion, offsetAtPosition, matchingBrace, vertexHookFeatureAt, vertexHookCompletionFeatures, vertexHookMatches, consumeList, convertDocumentSymbol, convertDiagnostic, shiftedPosition, shiftedRange, userRange, zeroRange, comparePositions, rangesOverlap, consumeCompilerTargets, INCLUDE_STRING_PATTERN, INCLUDE_IDENT_PATTERN, IMPORT_PATTERN, MODULE_DECL_PATTERN, IMPLEMENTING_DECL_PATTERN, resolveCompilerDependencies, sourcePath, moduleName, parseCompilerDiagnostics, slangType, markup, localSourceHover, currentDocumentDefinitionLine, generatedLocalDefinitionLine, escapeRegExp, wordAt, memberCompletions, slangExpressionContext, memberHover, moduleDirectiveHover, completionDocumentation, shaderStudioInputMemberCompletions, inputMethodCompletion, isGeneratedInputImplementationSymbol, shaderStudioInputMethodSignaturesAtCall, nativeTextureMemberCompletions, nativeTextureMember, generatedEnvironmentGlobals, generatedSamplingFunctions, slangStorageBufferType, slangStorageElementType, environmentTypeName, intrinsicReturnType, declaresSlangType, findSlangDeclarations, authoredChannelCollisionDiagnostics, offsetRange, positionAtOffset, authoredPointRange, nativeDefinitionKey, identifierOccurrences, SLANG_CALL_KEYWORDS, callAt, documentedSlangFunctions, intrinsic, completionForIntrinsic, intrinsicMarkup } from "../SlangLanguageServiceSupport.js";
import type { SlangMainImageFeature, SlangVertexHookMatch, SlangDeclaration } from "../SlangLanguageServiceSupport.js";
import type { SlangLanguageServiceBackend } from "../SlangLanguageServiceBackend.js";

export class SlangNavigationProvider {
  constructor(private readonly backend: SlangLanguageServiceBackend) {}

  async definition(params: DocumentPositionParams): Promise<Location[]> {
    const state = this.backend.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.backend.server.gotoDefinition(params.document.uri, shiftedPosition(params.position, state.offset)), (item) => {
      const range = item.uri === params.document.uri ? userRange(item.range, state.offset, state.document.text) : item.range;
      return range ? { uri: item.uri, range } : undefined;
    }).filter((item): item is Location => item !== undefined);
    if (official.some((location) => location.uri !== params.document.uri)) {
      return official;
    }
    const word = wordAt(state.document.text, params.position);
    const local = findSlangDeclarations(state.document.text).find((item) => item.name === word);
    if (local) {
      return official.length > 0 ? official : [{ uri: params.document.uri, range: local.selectionRange }];
    }
    const imported = word ? contextualFiles(state.environment).flatMap((file) => (
      findSlangDeclarations(file.text)
        .filter((item) => item.name === word)
        .map((item) => ({ uri: file.uri, range: item.selectionRange }))
    )) : [];
    return imported.length > 0 ? imported : official;
  }

  async signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null> {
    const state = this.backend.current(params);
    if (!state) {
      return null;
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const result = this.backend.server.signatureHelp(params.document.uri, shiftedPosition(params.position, state.offset));
    if (result) {
      const signatures = consumeList(result.signatures, (signature) => ({
        label: signature.label,
        documentation: markup(signature.documentation),
        parameters: consumeList(signature.parameters, (parameter) => ({ label: parameter.label, documentation: markup(parameter.documentation) })),
      }));
      return { signatures, activeSignature: result.activeSignature, activeParameter: result.activeParameter };
    }
    const call = callAt(state.document.text, params.position);
    if (!call) {
      return null;
    }
    const signatures = findSlangDeclarations(state.document.text).filter((item) => item.kind === SymbolKind.Function && item.name === call.name);
    const contextual = contextualFiles(state.environment).flatMap((file) => (
      findSlangDeclarations(file.text).filter((item) => item.kind === SymbolKind.Function && item.name === call.name)
    ));
    const intrinsics = documentedSlangFunctions(state.environment).filter((item) => item.name === call.name);
    const inputMethods = shaderStudioInputMethodSignaturesAtCall(state, params.position, call.name);
    const labels = [
      ...signatures.map((item) => item.detail),
      ...contextual.map((item) => item.detail),
      ...intrinsics.flatMap((item) => item.signatures),
      ...inputMethods,
      ...generatedSamplingFunctions(state.environment).filter(item => item.name === call.name).map(item => item.detail),
    ];
    return labels.length > 0 ? { signatures: labels.map((label) => ({ label })), activeSignature: 0, activeParameter: call.parameter } : null;
  }

  async references(params: ReferenceParams): Promise<Location[]> {
    if (!this.backend.current(params)) {
      return [];
    }
    const target = resolveSlangSymbol(this.backend.renameDocuments(), params.document.uri, params.position);
    if (!target) {
      return [];
    }
    const points = params.includeDeclaration ? [target.declaration, ...target.references] : target.references;
    return points.flatMap(point => {
      const range = authoredPointRange(this.backend.documentText(point.uri), point.offset);
      return range ? [{ uri: point.uri, range }] : [];
    });
  }

  async documentHighlights(params: DocumentPositionParams): Promise<DocumentHighlight[]> {
    if (!this.backend.current(params)) {
      return [];
    }
    const target = resolveSlangSymbol(this.backend.renameDocuments(), params.document.uri, params.position);
    if (!target) {
      return [];
    }
    const declaration = target.declaration.uri === params.document.uri
      ? authoredPointRange(this.backend.documentText(target.declaration.uri), target.declaration.offset) : undefined;
    return [
      ...(declaration ? [{ range: declaration, kind: DocumentHighlightKind.Write }] : []),
      ...target.references.flatMap(point => {
        const range = point.uri === params.document.uri ? authoredPointRange(this.backend.documentText(point.uri), point.offset) : undefined;
        return range ? [{ range, kind: DocumentHighlightKind.Read }] : [];
      }),
    ];
  }

  async rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    if (!this.backend.current(params)) {
      return null;
    }
    const documents = this.backend.renameDocuments();
    const source = this.backend.store.getDocument(params.document.uri)?.text ?? "";
    const native = /\bgeneric\s*<|\bimport\s+|\bstruct\s+\w+\s*\{[\s\S]*?\w+\s*\(/.test(source)
      ? this.backend.nativeRename(documents, params) : null;
    const edit = native ?? renameSlangSymbol(documents, params.document.uri, params.position, params.newName);
    const valid = edit && this.backend.renameCompiles(documents, edit);
    return valid ? edit : null;
  }

}
