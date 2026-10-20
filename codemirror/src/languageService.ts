import { snippet, type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { forceLinting, linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { closeHoverTooltips, EditorView, hoverTooltip, keymap, ViewPlugin, type Tooltip } from "@codemirror/view";
import type { LanguageService } from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { CompletionItem, Position, Range } from "vscode-languageserver-protocol";

export type LanguageServiceStatus = "pending" | "ready" | "error";
export type LanguageServiceFactory = () => Promise<LanguageService>;
export interface CodeMirrorLanguageServiceOptions {
  /** Opens definitions which live in a different Shader Studio document. */
  onNavigate?: (uri: string, line: number, column: number) => void;
}

/**
 * CodeMirror adapters for Shader Studio's language-server protocol.
 *
 * An instance owns one editor document. Call `syncEnvironment` whenever the
 * host's shader context changes; requests always synchronise the live
 * CodeMirror text first, which prevents a completion request racing a recent
 * keystroke from querying an older server revision.
 */
export class CodeMirrorLanguageService {
  readonly completionSource: CompletionSource = context => this.complete(context);
  private disposed = false;
  private descriptionsEnabled = true;
  private servicePromise?: Promise<LanguageService>;
  private serviceDisposed = false;
  private environment?: ShaderAuthoringEnvironment;
  private documentVersion = 0;
  private opened = false;
  private syncedText?: string;
  private environmentGeneration = 0;
  private requestedText?: string;
  private syncQueue: Promise<void> = Promise.resolve();
  private documentEpoch = 0;
  private readonly views = new Set<EditorView>();

  constructor(
    private readonly factory: LanguageServiceFactory,
    private readonly onStatus?: (status: LanguageServiceStatus) => void,
    private readonly options: CodeMirrorLanguageServiceOptions = {},
  ) {
    this.onStatus?.("pending");
    void this.service().catch(() => undefined);
  }

  extensions(): Extension[] {
    const views = this.views;
    return [
      hoverTooltip((view, pos) => this.hover(view.state.doc.toString(), pos)),
      linter(view => this.diagnostics(view.state.doc.toString())),
      ViewPlugin.fromClass(class {
        constructor(private readonly view: EditorView) {
          views.add(view);
        }
        destroy() {
          views.delete(this.view);
        }
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          this.documentEpoch += 1;
          this.requestedText = undefined;
        }
      }),
      keymap.of([{ key: "F12", run: view => this.startDefinition(view) }]),
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!(event.ctrlKey || event.metaKey)) {
            return false;
          }
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) {
            return false;
          }
          void this.goDefinition(view, pos);
          return true;
        },
      }),
    ];
  }

  setDescriptionsEnabled(enabled: boolean): void {
    if (this.descriptionsEnabled === enabled) {
      return;
    }
    this.descriptionsEnabled = enabled;
    if (!enabled) {
      for (const view of this.views) {
        view.dispatch({ effects: closeHoverTooltips });
      }
    }
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (this.disposed) {
      return;
    }
    const previous = this.environment;
    const changedDocument = previous?.documentUri !== undefined
      && (previous.documentUri !== environment.documentUri || previous.languageId !== environment.languageId);
    const changed = !previous || JSON.stringify({ ...previous, generation: 0 })
      !== JSON.stringify({ ...environment, generation: 0 });
    this.environmentGeneration = previous
      ? (changed ? Math.max(environment.generation, previous.generation + 1) : previous.generation)
      : environment.generation;
    this.environment = { ...environment, generation: this.environmentGeneration };
    const currentEnvironment = this.environment;
    const service = await this.service();
    if (!this.disposed && currentEnvironment === this.environment) {
      if (changedDocument && previous) {
        if (this.opened) {
          await service.closeDocument(previous.documentUri);
        }
        this.opened = false;
        this.syncedText = undefined;
        this.documentVersion = 0;
      }
      await service.syncEnvironment(currentEnvironment);
      for (const view of this.views) {
        forceLinting(view);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.environment = undefined;
    this.opened = false;
    this.syncedText = undefined;
    void this.servicePromise?.then(service => this.disposeService(service)).catch(() => undefined);
  }

  private async service(): Promise<LanguageService> {
    this.servicePromise ??= Promise.resolve()
      .then(this.factory)
      .then(async service => {
        await service.initialize();
        if (this.disposed) {
          await this.disposeService(service);
        } else {
          this.onStatus?.("ready");
        }
        return service;
      })
      .catch(error => {
        this.onStatus?.("error");
        throw error;
      });
    return this.servicePromise;
  }

  private async complete(context: CompletionContext) {
    const snapshot = await this.syncDocument(context.state.doc.toString());
    if (!snapshot) {
      return null;
    }
    try {
      const items = await snapshot.service.completion({ document: snapshot.revision, position: positionAt(snapshot.text, context.pos) });
      if (!this.current(snapshot)) {
        return null;
      }
      const from = context.matchBefore(/[_$A-Za-z][_$A-Za-z0-9]*/)?.from ?? context.pos;
      return {
        from,
        options: items.map(item => completion(item, snapshot.text, from, context.pos)),
        validFor: /^[_$A-Za-z0-9]*$/,
      };
    } catch {
      return null;
    }
  }

  private async hover(text: string, pos: number): Promise<Tooltip | null> {
    if (!this.descriptionsEnabled) {
      return null;
    }
    const snapshot = await this.syncDocument(text);
    if (!snapshot || !this.descriptionsEnabled) {
      return null;
    }
    try {
      const result = await snapshot.service.hover({ document: snapshot.revision, position: positionAt(text, pos) });
      if (!result || !this.descriptionsEnabled || !this.current(snapshot)) {
        return null;
      }
      const range = result.range ? offsetsForRange(text, result.range) : undefined;
      const content = markdownText(result.contents);
      if (!content) {
        return null;
      }
      return {
        pos: range?.from ?? pos,
        end: range?.to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-tooltip-hover";
          dom.textContent = content;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  }

  private async diagnostics(text: string): Promise<Diagnostic[]> {
    const snapshot = await this.syncDocument(text);
    if (!snapshot) {
      return [];
    }
    try {
      const diagnostics = await snapshot.service.diagnostics({ document: snapshot.revision });
      if (!this.current(snapshot)) {
        return [];
      }
      return diagnostics.map(item => ({
        ...offsetsForRange(text, item.range),
        message: markdownText(item.message),
        severity: diagnosticSeverity(item.severity),
        source: item.source,
      }));
    } catch {
      return [];
    }
  }

  private startDefinition(view: EditorView): boolean {
    void this.goDefinition(view, view.state.selection.main.head);
    return true;
  }

  private async goDefinition(view: EditorView, pos: number): Promise<void> {
    const text = view.state.doc.toString();
    const snapshot = await this.syncDocument(text);
    if (!snapshot) {
      return;
    }
    try {
      const definitions = await snapshot.service.definition({
        document: snapshot.revision,
        position: positionAt(text, pos),
      });
      if (!this.current(snapshot) || definitions.length === 0) {
        return;
      }
      const target = definitions[0];
      if (target.uri !== snapshot.revision.uri) {
        this.options.onNavigate?.(target.uri, target.range.start.line, target.range.start.character);
        return;
      }
      const selection = offsetAt(text, target.range.start);
      view.dispatch({ selection: { anchor: selection }, scrollIntoView: true });
    } catch {
      // Navigation is deliberately best-effort: a language worker restarting
      // must not turn an editor gesture into an uncaught browser error.
    }
  }

  private async syncDocument(text: string): Promise<Snapshot | undefined> {
    this.requestedText = text;
    const next = this.syncQueue.then(() => this.syncDocumentNow(text));
    this.syncQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async syncDocumentNow(text: string): Promise<Snapshot | undefined> {
    const environment = this.environment;
    if (this.disposed || text !== this.requestedText || !environment) {
      return undefined;
    }
    try {
      const service = await this.service();
      if (this.disposed || text !== this.requestedText || environment !== this.environment) {
        return undefined;
      }
      await service.syncEnvironment(environment);
      if (this.disposed || text !== this.requestedText || environment !== this.environment) {
        return undefined;
      }
      if (this.syncedText !== text) {
        this.documentVersion += 1;
        const document = { uri: environment.documentUri, languageId: environment.languageId, version: this.documentVersion, text };
        if (this.opened) {
          await service.changeDocument(document);
        } else {
          await service.openDocument(document);
          this.opened = true;
        }
        if (this.disposed || text !== this.requestedText || environment !== this.environment) {
          return undefined;
        }
        this.syncedText = text;
      }
      return { service, text, documentEpoch: this.documentEpoch, revision: {
        uri: environment.documentUri,
        languageId: environment.languageId,
        version: this.documentVersion,
        environmentGeneration: environment.generation,
      } };
    } catch {
      return undefined;
    }
  }

  private current(snapshot: Snapshot): boolean {
    return !this.disposed
      && this.environment?.documentUri === snapshot.revision.uri
      && this.environment.generation === snapshot.revision.environmentGeneration
      && this.documentVersion === snapshot.revision.version
      && this.syncedText === snapshot.text
      && this.requestedText === snapshot.text
      && this.documentEpoch === snapshot.documentEpoch;
  }

  private async disposeService(service: LanguageService): Promise<void> {
    if (this.serviceDisposed) {
      return;
    }
    this.serviceDisposed = true;
    await service.dispose();
  }
}

interface Snapshot {
  service: LanguageService;
  text: string;
  documentEpoch: number;
  revision: { uri: string; languageId: ShaderAuthoringEnvironment["languageId"]; version: number; environmentGeneration: number };
}

function completion(item: CompletionItem, text: string, fallbackFrom: number, fallbackTo: number): Completion {
  const edit = item.textEdit && "range" in item.textEdit ? item.textEdit : undefined;
  const range = edit ? offsetsForRange(text, edit.range) : { from: fallbackFrom, to: fallbackTo };
  const insert = edit?.newText ?? (typeof item.insertText === "string" ? item.insertText : item.label);
  return {
    label: item.label,
    detail: item.detail,
    info: markdownText(item.documentation),
    type: completionType(item.kind),
    boost: item.sortText ? undefined : 1,
    apply: item.insertTextFormat === 2
      ? (view, completion, from, to) => snippet(insert)(view, completion, range.from, range.to)
      : (view) => view.dispatch({ changes: { from: range.from, to: range.to, insert } }),
  };
}

function completionType(kind: number | undefined): string | undefined {
  const names: Record<number, string> = { 2: "method", 3: "function", 5: "class", 6: "variable", 7: "variable", 14: "keyword", 15: "snippet", 21: "constant", 22: "struct" };
  return kind === undefined ? undefined : names[kind];
}

function diagnosticSeverity(severity: number | undefined): Diagnostic["severity"] {
  return severity === 1 ? "error" : severity === 2 ? "warning" : severity === 3 ? "info" : "hint";
}

function markdownText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(markdownText).filter(Boolean).join("\n\n");
  }
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  return "";
}

function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, character: before.length - (before.lastIndexOf("\n") + 1) };
}

function offsetsForRange(text: string, range: Range): { from: number; to: number } {
  return { from: offsetAt(text, range.start), to: offsetAt(text, range.end) };
}

function offsetAt(text: string, position: Position): number {
  let offset = 0;
  for (let line = 0; line < Math.max(0, position.line) && offset < text.length; line += 1) {
    const next = text.indexOf("\n", offset);
    offset = next < 0 ? text.length : next + 1;
  }
  const lineEnd = text.indexOf("\n", offset);
  return Math.max(offset, Math.min(lineEnd < 0 ? text.length : lineEnd, offset + Math.max(0, position.character)));
}
