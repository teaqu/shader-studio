import { declarationDocumentation } from "../documentation.js";
import type { DocumentPositionParams } from "@shader-studio/language-server-core";
import { isPositionInComment } from "@shader-studio/language-server-core";
import { SHADER_STUDIO_SYMBOL_DOCS } from "@shader-studio/types";
import { symbolAtPosition, visibleSymbolsAtPosition } from "@shader-studio/wgsl-analysis";
import type { Hover } from "vscode-languageserver-protocol";
import { findWgslAttribute, findWgslIntrinsics } from "../intrinsics.js";
import type { WgslProviderContext } from "../WgslLanguageServiceBackend.js";
import { authoringValueWgslType, declarationLabel, generatedWgslFunctions, identifierSite, isAttributeName, mainImageFeature, markdownHover, memberHover, signatureInformation, typedName, vertexHookFeature, wgslStage, wordAt } from "../WgslLanguageServiceSupport.js";

export class WgslHoverProvider {
  constructor(private readonly context: WgslProviderContext) {}
  async provide(params: DocumentPositionParams): Promise<Hover | null> {
    const state = this.context.current(params);
    if (!state || isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const word = wordAt(state.document.text, params.position);
    if (!word) {
      return null;
    }
    if (isAttributeName(state.document.text, params.position)) {
      const attribute = findWgslAttribute(word);
      return attribute ? markdownHover(attribute.signature, attribute.description) : null;
    }
    const site = identifierSite(state.document.text, params.position);
    if (site?.kind === "attribute-argument") {
      const builtin = findWgslIntrinsics(word).find((item) => item.kind === "variable");
      return builtin ? markdownHover(builtin.signature, builtin.description) : null;
    }
    const includes = this.context.includes(params.document.uri);
    if (site?.kind === "member") {
      return memberHover(site, state.document.text, params.document.uri, state.environment, includes);
    }
    const resolved = symbolAtPosition(state.analysis, params.position) ?? visibleSymbolsAtPosition(state.analysis, params.position).find((symbol) => symbol.name === word) ?? state.analysis.symbols.find((symbol) => symbol.name === word);
    const userSymbol = resolved && !state.analysis.hostGlobalIds.has(resolved.id) ? resolved : undefined;
    if (userSymbol) {
      const vertexHook = state.environment.stage === "vertex" ? vertexHookFeature(state.analysis, userSymbol) : undefined;
      const fragmentHook = state.environment.stage === "fragment" ? mainImageFeature(state.analysis, userSymbol) : undefined;
      const hook = vertexHook ?? fragmentHook;
      return hook ? markdownHover(hook.signature, hook.description) : markdownHover(declarationLabel(state.analysis, userSymbol), declarationDocumentation(state.analysis, userSymbol, "Declared in this shader."));
    }
    for (const analysis of includes) {
      const included = analysis.symbols.find((symbol) => symbol.name === word && !analysis.hostGlobalIds.has(symbol.id));
      if (included) {
        return markdownHover(declarationLabel(analysis, included), declarationDocumentation(analysis, included, analysis.uri === state.environment.commonFile?.uri ? "Declared in Shader Studio Common." : "Declared in an included shader file."));
      }
    }
    const doc = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === word && item.languages.includes("wgsl"));
    if (doc) {
      return markdownHover(`var<private> ${typedName(doc.name, doc.wgslType)}`, doc.description);
    }
    const uniform = state.environment.customUniforms.find((item) => item.name === word);
    if (uniform) {
      return markdownHover(`var<private> ${typedName(uniform.name, authoringValueWgslType(uniform.type))}`, "Shader Studio custom uniform.");
    }
    const resource = state.environment.resources.find((item) => item.name === word);
    if (resource) {
      return markdownHover(`${resource.kind} ${resource.name}`, "Shader Studio shader resource.");
    }
    const generated = generatedWgslFunctions(state.environment).find((item) => item.name === word);
    if (generated) {
      return markdownHover(signatureInformation(generated.name, generated.parameters, generated.returnType).label, generated.description);
    }
    const intrinsic = findWgslIntrinsics(word).find((item) => item.stages.includes(wgslStage(state.environment.stage)));
    return intrinsic ? markdownHover(intrinsic.signature, intrinsic.description) : null;
  }
}
