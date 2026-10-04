import { isFragmentOnlyNativePosition } from "../NativeStageReachability.js";
import { findMemberAccess, isPositionInComment, type DocumentPositionParams } from "@shader-studio/language-server-core";
import { SHADER_STUDIO_SYMBOL_DOCS } from "@shader-studio/types";
import { parseWgslDocumentAtPosition, visibleSymbolsAtPosition } from "@shader-studio/wgsl-analysis";
import { CompletionItemKind, MarkupKind, type CompletionItem } from "vscode-languageserver-protocol";
import { WGSL_VERTEX_HOOK_FEATURES } from "../vertexHook.js";
import type { WgslProviderContext } from "../WgslLanguageServiceBackend.js";
import { authoringValueWgslType, completionFromDoc, completionKind, generatedWgslFunctions, inferenceContext, mainImageFeature, markdownDocumentation, memberCompletions, signatureInformation, vertexHookFeature, visibleIntrinsics } from "../WgslLanguageServiceSupport.js";

export class WgslCompletionProvider {
  constructor(private readonly context: WgslProviderContext) {}
  async provide(params: DocumentPositionParams): Promise<CompletionItem[]> {
    const state = this.context.current(params);
    if (!state || isPositionInComment(state.document.text, params.position)) {
      return [];
    }
    const includes = this.context.includes(params.document.uri);
    const access = findMemberAccess(state.document.text, params.position);
    if (access) {
      return memberCompletions(access.expression, params.position, state.document.text, state.environment, includes, params.document.uri);
    }
    const items = new Map<string, CompletionItem>();
    const authoredNames = new Set<string>();
    const analysis = state.analysis.parsedSuccessfully ? state.analysis : parseWgslDocumentAtPosition(params.document.uri, state.document.text, state.environment.stage, params.position, inferenceContext(state.environment, includes));
    for (const symbol of visibleSymbolsAtPosition(analysis, params.position)) {
      const hook = (state.environment.stage === "vertex" ? vertexHookFeature(analysis, symbol) : undefined) ?? (state.environment.stage === "fragment" ? mainImageFeature(analysis, symbol) : undefined);
      items.set(symbol.name, { label: symbol.name, kind: completionKind(symbol), detail: hook?.signature ?? symbol.signature ?? symbol.typeName, documentation: hook ? markdownDocumentation(hook.description) : undefined });
      if (!analysis.hostGlobalIds.has(symbol.id)) {
        authoredNames.add(symbol.name);
      }
    }
    for (const included of includes) {
      for (const symbol of included.symbols) {
        if (included.uri === "shader-studio://generated/channels.wgsl" && (symbol.name.startsWith("_ss") || !included.scopes.some((scope) => scope.id === symbol.scopeId && scope.kind === "global"))) {
          continue;
        }
        if (analysis.uri === "shader-studio://generated/channels.wgsl" && state.environment.stage !== "fragment"
          && !isFragmentOnlyNativePosition(state.document.text, params.position)
          && /(?:Sample|SampleBias)$/.test(symbol.name)) {
          continue;
        }
        if (!items.has(symbol.name)) {
          items.set(symbol.name, { label: symbol.name, kind: completionKind(symbol), detail: symbol.signature ?? symbol.typeName });
        }
      }
    }
    if (state.environment.stage === "vertex") {
      const hook = WGSL_VERTEX_HOOK_FEATURES[0];
      if (hook && !items.has(hook.name)) {
        items.set(hook.name, { label: hook.name, kind: CompletionItemKind.Function, detail: hook.signature, documentation: markdownDocumentation(hook.description) });
      }
    }
    for (const generated of generatedWgslFunctions(state.environment)) {
      if (!items.has(generated.name)) {
        items.set(generated.name, { label: generated.name, kind: CompletionItemKind.Function, detail: signatureInformation(generated.name, generated.parameters, generated.returnType).label, documentation: markdownDocumentation(generated.description) });
      }
    }
    for (const intrinsic of visibleIntrinsics(state.environment.stage)) {
      items.set(`${intrinsic.name}:${intrinsic.signature}`, { label: intrinsic.name, kind: intrinsic.kind === "function" ? CompletionItemKind.Function : CompletionItemKind.Variable, detail: intrinsic.signature, documentation: { kind: MarkupKind.Markdown, value: intrinsic.description } });
    }
    for (const doc of SHADER_STUDIO_SYMBOL_DOCS) {
      if (doc.name !== "iChannelN" && !authoredNames.has(doc.name) && doc.languages.includes("wgsl") && (!doc.stages || doc.stages.includes(state.environment.stage))) {
        items.set(doc.name, completionFromDoc(doc.name, doc.wgslType, doc.description));
      }
    }
    for (const uniform of state.environment.customUniforms) {
      if (!authoredNames.has(uniform.name)) {
        items.set(uniform.name, completionFromDoc(uniform.name, authoringValueWgslType(uniform.type), "Shader Studio custom uniform."));
      }
    }
    for (const resource of state.environment.resources) {
      if (!items.has(resource.name)) {
        items.set(resource.name, completionFromDoc(resource.name, resource.kind, "Shader Studio shader resource."));
      }
    }
    return [...items.values()];
  }
}
