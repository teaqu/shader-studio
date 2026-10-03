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

export class SlangSymbolsProvider {
  constructor(private readonly backend: SlangLanguageServiceBackend) {}

  async provide(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.backend.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.backend.server.documentSymbol(params.document.uri), (item) => convertDocumentSymbol(item, state.offset, state.document.text))
      .filter((item): item is DocumentSymbol => item !== undefined);
    return official.length > 0 ? official : findSlangDeclarations(state.document.text).map((item) => ({
      name: item.name,
      detail: item.detail,
      kind: item.kind,
      range: item.range,
      selectionRange: item.selectionRange,
    }));
  }

}
