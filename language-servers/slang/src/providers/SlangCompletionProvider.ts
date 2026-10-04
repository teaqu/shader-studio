import {
  declarationContext,
  findMemberAccess,
  isInsideBlock,
  isPositionInComment,
  rankCompletionsForContext,
  type DocumentPositionParams
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  isShaderEntryPointName,
  isShaderTypeKeyword,
  shaderTypeCompletionKeywords
} from "@shader-studio/types";
import {
  CompletionItemKind,
  MarkupKind,
  SymbolKind,
  type CompletionItem
} from "vscode-languageserver-protocol";
import { SLANG_COMPUTE_FEATURES } from "../computeFeatures.js";
import { visibleSlangLocals } from "../expressionType.js";

import { completionForIntrinsic, computeFeatureMarkup, consumeList, contextualFiles, contractMarkup, declaresSlangType, documentedSlangFunctions, findSlangDeclarations, generatedEnvironmentGlobals, generatedSamplingFunctions, intrinsicMarkup, isGeneratedInputImplementationSymbol, mainImageCompletionFeature, mainImageCoordinateCompletion, markup, memberCompletions, shiftedPosition, slangExpressionContext, slangType, userRange, vertexHookCompletionFeatures, vertexHookMarkup } from "../SlangLanguageServiceSupport.js";
import type { SlangCompletionContext } from "./SlangProviderContext.js";

export class SlangCompletionProvider {
  constructor(private readonly context: SlangCompletionContext) {}

  async provide(params: DocumentPositionParams): Promise<CompletionItem[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return [];
    }
    // A name is being invented after a type, so nothing that already exists fits.
    const context = declarationContext(
      state.document.text,
      params.position,
      (word) => isShaderTypeKeyword("slang", word) || declaresSlangType(state.document.text, word),
    );
    const documentedFunctions = documentedSlangFunctions(state.environment);
    const computeFeatures = state.environment.stage === "compute" ? SLANG_COMPUTE_FEATURES : [];
    const vertexFeatures = state.environment.stage === "vertex"
      ? vertexHookCompletionFeatures(state.document.text)
      : [];
    const official = consumeList(this.context.completion(params.document.uri, shiftedPosition(params.position, state.offset), {
      triggerKind: 1,
      triggerCharacter: "",
    }), (item) => {
      const editRange = item.textEdit ? userRange(item.textEdit.range, state.offset, state.document.text) : undefined;
      const intrinsic = documentedFunctions.find((entry) => entry.name === item.label);
      const computeFeature = computeFeatures.find((entry) => entry.name === item.label);
      const fragmentFeature = state.environment.stage === "fragment"
        ? mainImageCompletionFeature(state.document.text, params.position, item.label)
        : undefined;
      const officialDocumentation = item.documentation ? markup(item.documentation) : undefined;
      return {
        label: item.label,
        kind: item.kind as CompletionItemKind,
        detail: fragmentFeature?.signature ?? (item.detail?.trim() || intrinsic?.signatures[0]),
        documentation: computeFeature
          ? computeFeatureMarkup(computeFeature)
          : fragmentFeature
            ? contractMarkup(fragmentFeature.signature, fragmentFeature.description)
            : officialDocumentation?.value.trim()
              ? officialDocumentation
              : intrinsic ? intrinsicMarkup(intrinsic) : undefined,
        textEdit: item.textEdit && editRange ? { range: editRange, newText: item.textEdit.text } : undefined,
        data: item.data,
      };
    });
    const items = new Map<string, CompletionItem>(official
      .filter((item) => !isGeneratedInputImplementationSymbol(item.label))
      .map((item) => [`${item.label}:${item.detail ?? ""}`, item]));
    const access = findMemberAccess(state.document.text, params.position);
    if (access) {
      for (const item of memberCompletions(access.expression, params.position, state.document.text, state.environment)) {
        const key = `${item.label}:${item.detail ?? ""}`;
        if (!items.has(key)) {
          items.set(key, item);
        }
      }
      return [...items.values()];
    }
    const officialLabels = new Set(official.map((item) => item.label));
    for (const intrinsic of documentedFunctions) {
      if (officialLabels.has(intrinsic.name)) {
        continue;
      }
      const item = completionForIntrinsic(intrinsic);
      items.set(`${item.label}:${item.detail}`, item);
    }
    for (const feature of computeFeatures) {
      if (officialLabels.has(feature.name)) {
        continue;
      }
      items.set(`${feature.name}:${feature.syntax}`, {
        label: feature.name,
        kind: feature.kind === "attribute" ? CompletionItemKind.Keyword : CompletionItemKind.Variable,
        detail: feature.syntax,
        documentation: computeFeatureMarkup(feature),
      });
    }
    for (const doc of SHADER_STUDIO_SYMBOL_DOCS) {
      if (!doc.languages.includes("slang") || (doc.stages && !doc.stages.includes(state.environment.stage))) {
        continue;
      }
      if (doc.name === "iChannelN" || doc.name === "iChannelResolution" || doc.name === "iChannelTime" || doc.name === "iChannelLoaded") {
        continue;
      }
      items.set(`${doc.name}:${doc.slangType}`, {
        label: doc.name,
        kind: CompletionItemKind.Variable,
        detail: doc.slangType,
        documentation: { kind: MarkupKind.Markdown, value: doc.description },
      });
    }
    for (const uniform of state.environment.customUniforms) {
      items.set(`${uniform.name}:${uniform.type}`, { label: uniform.name, kind: CompletionItemKind.Variable, detail: slangType(uniform.type) });
    }
    for (const resource of state.environment.resources.filter((resource) => resource.kind === "storage")) {
      items.set(`${resource.name}:${resource.kind}`, { label: resource.name, kind: CompletionItemKind.Variable, detail: resource.kind });
    }
    for (const generated of generatedEnvironmentGlobals(state.environment)) {
      items.set(`${generated.name}:${generated.type}`, {
        label: generated.name,
        kind: CompletionItemKind.Variable,
        detail: generated.type,
      });
    }
    for (const declaration of generatedSamplingFunctions(state.environment)) {
      items.set(`${declaration.name}:${declaration.detail}`, { label: declaration.name, kind: CompletionItemKind.Function, detail: declaration.detail });
    }
    for (const file of contextualFiles(state.environment)) {
      for (const declaration of findSlangDeclarations(file.text)) {
        items.set(`${declaration.name}:${declaration.detail}`, {
          label: declaration.name,
          kind: declaration.kind === SymbolKind.Function ? CompletionItemKind.Function : CompletionItemKind.Struct,
          detail: declaration.detail,
        });
      }
    }
    for (const declaration of findSlangDeclarations(state.document.text)) {
      const fragmentFeature = state.environment.stage === "fragment"
        ? mainImageCompletionFeature(state.document.text, params.position, declaration.name)
        : undefined;
      items.set(`${declaration.name}:${declaration.detail}`, {
        label: declaration.name,
        kind: declaration.kind === SymbolKind.Function ? CompletionItemKind.Function : CompletionItemKind.Struct,
        detail: fragmentFeature?.signature ?? declaration.detail,
        documentation: fragmentFeature ? contractMarkup(fragmentFeature.signature, fragmentFeature.description) : undefined,
      });
    }
    if (state.environment.stage === "fragment") {
      const coordinate = mainImageCoordinateCompletion(state.document.text, params.position);
      if (coordinate) {
        items.set(`${coordinate.name}:${coordinate.feature.signature}`, {
          label: coordinate.name,
          kind: CompletionItemKind.Variable,
          detail: coordinate.feature.signature,
          documentation: contractMarkup(coordinate.feature.signature, coordinate.feature.description),
        });
      }
    }
    for (const feature of vertexFeatures) {
      for (const [key, item] of items) {
        if (item.label === feature.name) {
          items.delete(key);
        }
      }
      items.set(`${feature.name}:${feature.signature}`, {
        label: feature.name,
        kind: feature.kind === "function" ? CompletionItemKind.Function : CompletionItemKind.Variable,
        detail: feature.signature,
        documentation: vertexHookMarkup(feature),
      });
    }
    // The server offers some Shader Studio globals, such as a channel, without a type.
    // Keep only the entry that describes it.
    const describedLabels = new Set([...items.values()].filter((item) => item.detail).map((item) => item.label));
    for (const [key, item] of items) {
      if (!item.detail && describedLabels.has(item.label)) {
        items.delete(key);
      }
    }
    // The official server offers no identifier completions for locals and parameters, so
    // add the ones in scope. Anything already listed keeps its richer entry.
    const listedLabels = new Set([...items.values()].map((item) => item.label));
    for (const local of visibleSlangLocals(state.document.text, params.position, slangExpressionContext(state.environment).includes)) {
      if (listedLabels.has(local.name)) {
        continue;
      }
      items.set(`${local.name}:${local.typeName}`, {
        label: local.name,
        kind: CompletionItemKind.Variable,
        detail: local.typeName,
      });
    }
    // A name is being invented, so the author's own symbols do not belong. The
    // renderer's entry points do: they have to be spelled exactly.
    if (context === "declarator") {
      return [...items.values()].filter((item) => isShaderEntryPointName(item.label));
    }
    const insideFunctionBody = isInsideBlock(state.document.text, params.position);
    for (const type of shaderTypeCompletionKeywords("slang", { insideFunctionBody })) {
      const key = `${type}:type`;
      if (![...items.values()].some((item) => item.label === type)) {
        items.set(key, { label: type, kind: CompletionItemKind.Keyword, detail: "type" });
      }
    }
    return rankCompletionsForContext(
      [...items.values()],
      context,
      (label) => isShaderTypeKeyword("slang", label),
    );
  }

}
