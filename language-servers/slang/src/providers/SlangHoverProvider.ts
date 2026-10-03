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

export class SlangHoverProvider {
  constructor(private readonly backend: SlangLanguageServiceBackend) {}

  async provide(params: DocumentPositionParams): Promise<Hover | null> {
    const state = this.backend.current(params);
    if (!state) {
      return null;
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const word = wordAt(state.document.text, params.position);
    const directive = word ? moduleDirectiveHover(state.document.text, params.position, word, state.environment) : undefined;
    if (directive) {
      return { contents: directive };
    }
    const doc = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === word && item.languages.includes("slang"));
    if (doc) {
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${doc.slangType} ${doc.name}\n\`\`\`\n\n${doc.description}` } };
    }
    const input = state.environment.resources.find((resource) => resource.kind !== "storage" && resource.name === word);
    if (input && input.kind !== "storage") {
    // A local may deliberately shadow a configured channel. Resolve it before
    // the host global so authoring help follows the source-language scope rules.
      const localSymbol = findSlangLocalAt(state.document.text, params.position, slangExpressionContext(state.environment).includes);
      if (localSymbol) {
        const description = localSymbol.kind === "parameter" ? "\n\nParameter of this function." : "";
        return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${localSymbol.typeName} ${localSymbol.name}\n\`\`\`${description}` } };
      }
      const description = describeSlangChannel(input.kind);
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `\`\`\`slang\nShaderStudioChannel${description.shape} ${input.name}\n\`\`\`\n\nConfigured input channel. Use \`${input.name}\` to sample it and read its metadata.`,
        },
      };
    }
    const member = word ? memberHover(state.document.text, params.position, word, state.environment) : undefined;
    if (member) {
      return { contents: member };
    }
    const storage = state.environment.resources.find((resource) => resource.kind === "storage" && resource.name === word);
    if (storage) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `\`\`\`slang\n${slangStorageBufferType(storage, state.environment.stage)} ${storage.name}\n\`\`\`\n\nConfigured storage buffer. Index it to read or write an element.`,
        },
      };
    }
    const uniform = state.environment.customUniforms.find((item) => item.name === word);
    if (uniform) {
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${slangType(uniform.type)} ${uniform.name}\n\`\`\`\n\nShader Studio custom uniform.` } };
    }
    const sampling = generatedSamplingFunctions(state.environment).find(item => item.name === word);
    if (sampling) {
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${sampling.detail}\n\`\`\`\n\nShader Studio sampling with bottom-left 2D coordinates and the supplied sampler.` } };
    }
    const intrinsic = word ? documentedSlangFunctions(state.environment).find((item) => item.name === word) : undefined;
    if (intrinsic) {
      return { contents: intrinsicMarkup(intrinsic) };
    }
    const computeFeature = state.environment.stage === "compute"
      ? SLANG_COMPUTE_FEATURES.find((item) => item.name === word)
      : undefined;
    if (computeFeature) {
      return { contents: computeFeatureMarkup(computeFeature) };
    }
    const vertexFeature = state.environment.stage === "vertex" && word
      ? vertexHookFeatureAt(state.document.text, params.position, word)
      : undefined;
    if (vertexFeature) {
      return { contents: vertexHookMarkup(vertexFeature) };
    }
    const fragmentFeature = state.environment.stage === "fragment" && word
      ? mainImageFeatureAt(state.document.text, params.position, word)
      : undefined;
    if (fragmentFeature) {
      return { contents: mainImageMarkup(fragmentFeature, params.document.uri) };
    }
    const common = state.environment.commonFile;
    const commonDeclaration = common && word
      ? findSlangDeclarations(common.text).find((item) => item.name === word)
      : undefined;
    if (commonDeclaration) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `\`\`\`slang\n${commonDeclaration.detail}\n\`\`\`\n\nDeclared in Shader Studio Common.`,
        },
      };
    }
    const local = findSlangDeclarations(state.document.text).find((item) => item.name === word);
    const result = this.backend.server.hover(params.document.uri, shiftedPosition(params.position, state.offset));
    if (result) {
      const contents = markup(result.contents);
      if (/Defined in [0-9a-f]{32,64}\(\d+\)/i.test(contents.value)) {
        const line = local?.selectionRange.start.line !== undefined
          ? local.selectionRange.start.line + 1
          : currentDocumentDefinitionLine(
            this.backend.server,
            params.document.uri,
            shiftedPosition(params.position, state.offset),
            state.offset,
            state.document.text,
          ) ?? generatedLocalDefinitionLine(contents.value, word, state.offset, state.document.text);
        if (line !== undefined) {
          contents.value = localSourceHover(contents.value, params.document.uri, line);
        }
      }
      return { contents, range: userRange(result.range, state.offset, state.document.text) };
    }
    // The server hovers top-level declarations only, so describe locals and parameters here.
    const localSymbol = findSlangLocalAt(state.document.text, params.position, slangExpressionContext(state.environment).includes);
    if (localSymbol) {
      const description = localSymbol.kind === "parameter" ? "\n\nParameter of this function." : "";
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${localSymbol.typeName} ${localSymbol.name}\n\`\`\`${description}` } };
    }
    if (local) {
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${local.detail}\n\`\`\`` }, range: local.selectionRange };
    }
    const imported = word ? state.environment.virtualFiles.flatMap((file) => (
      findSlangDeclarations(file.text).filter((item) => item.name === word).map((item) => ({ file, item }))
    ))[0] : undefined;
    return imported ? {
      contents: {
        kind: MarkupKind.Markdown,
        value: `\`\`\`slang\n${imported.item.detail}\n\`\`\`\n\nDeclared in \`${imported.file.uri.split("/").pop()}\`.`,
      },
    } : null;
  }

}
