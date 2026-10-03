import {
  isPositionInComment,
  type DocumentPositionParams,
  type ReferenceParams,
  type RenameParams
} from "@shader-studio/language-server-core";
import {
  DocumentHighlightKind,
  SymbolKind,
  type DocumentHighlight,
  type Location,
  type SignatureHelp,
  type WorkspaceEdit
} from "vscode-languageserver-protocol";
import { renameSlangSymbol, resolveSlangSymbol } from "../rename.js";

import { authoredPointRange, callAt, consumeList, contextualFiles, documentedSlangFunctions, findSlangDeclarations, generatedSamplingFunctions, markup, shaderStudioInputMethodSignaturesAtCall, shiftedPosition, userRange, wordAt } from "../SlangLanguageServiceSupport.js";
import type { SlangNavigationContext } from "./SlangProviderContext.js";

export class SlangNavigationProvider {
  constructor(private readonly context: SlangNavigationContext) {}

  async definition(params: DocumentPositionParams): Promise<Location[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.context.definition(params.document.uri, shiftedPosition(params.position, state.offset)), (item) => {
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
    const state = this.context.current(params);
    if (!state) {
      return null;
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const result = this.context.signatureHelp(params.document.uri, shiftedPosition(params.position, state.offset));
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
    if (!this.context.current(params)) {
      return [];
    }
    const target = resolveSlangSymbol(this.context.renameDocuments(), params.document.uri, params.position);
    if (!target) {
      return [];
    }
    const points = params.includeDeclaration ? [target.declaration, ...target.references] : target.references;
    return points.flatMap(point => {
      const range = authoredPointRange(this.context.documentText(point.uri), point.offset);
      return range ? [{ uri: point.uri, range }] : [];
    });
  }

  async documentHighlights(params: DocumentPositionParams): Promise<DocumentHighlight[]> {
    if (!this.context.current(params)) {
      return [];
    }
    const target = resolveSlangSymbol(this.context.renameDocuments(), params.document.uri, params.position);
    if (!target) {
      return [];
    }
    const declaration = target.declaration.uri === params.document.uri
      ? authoredPointRange(this.context.documentText(target.declaration.uri), target.declaration.offset) : undefined;
    return [
      ...(declaration ? [{ range: declaration, kind: DocumentHighlightKind.Write }] : []),
      ...target.references.flatMap(point => {
        const range = point.uri === params.document.uri ? authoredPointRange(this.context.documentText(point.uri), point.offset) : undefined;
        return range ? [{ range, kind: DocumentHighlightKind.Read }] : [];
      }),
    ];
  }

  async rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    if (!this.context.current(params)) {
      return null;
    }
    const documents = this.context.renameDocuments();
    const source = this.context.documentText(params.document.uri) ?? "";
    const native = /\bgeneric\s*<|\bimport\s+|\bstruct\s+\w+\s*\{[\s\S]*?\w+\s*\(/.test(source)
      ? this.context.nativeRename(documents, params) : null;
    const edit = native ?? renameSlangSymbol(documents, params.document.uri, params.position, params.newName);
    const valid = edit && this.context.renameCompiles(documents, edit);
    return valid ? edit : null;
  }

}
