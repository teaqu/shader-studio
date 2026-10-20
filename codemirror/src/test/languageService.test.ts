import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { EditorView, type Tooltip } from "@codemirror/view";
import type { LanguageService } from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { describe, expect, it, vi } from "vitest";
import { CodeMirrorLanguageService } from "../languageService";

const environment: ShaderAuthoringEnvironment = {
  documentUri: "shader://image.glsl",
  languageId: "glsl",
  generation: 2,
  passName: "Image",
  stage: "fragment",
  customUniforms: [],
  resources: [],
  virtualFiles: [],
};

interface Internals {
  complete(context: CompletionContext): Promise<{ from: number; options: Array<{ label: string; from?: number; to?: number; apply?: unknown }> } | null>;
  diagnostics(text: string): Promise<Array<{ from: number; to: number; severity?: string; message: string }>>;
  hover(text: string, pos: number): Promise<Tooltip | null>;
  goDefinition(view: EditorView, pos: number): Promise<void>;
  startDefinition(view: EditorView): boolean;
}

function mockService() {
  return {
    initialize: vi.fn().mockResolvedValue({}),
    syncEnvironment: vi.fn().mockResolvedValue(undefined),
    openDocument: vi.fn().mockResolvedValue(undefined),
    changeDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    completion: vi.fn().mockResolvedValue([]),
    hover: vi.fn().mockResolvedValue(null),
    definition: vi.fn().mockResolvedValue([]),
    signatureHelp: vi.fn().mockResolvedValue(null),
    documentSymbols: vi.fn().mockResolvedValue([]),
    references: vi.fn().mockResolvedValue([]),
    documentHighlights: vi.fn().mockResolvedValue([]),
    rename: vi.fn().mockResolvedValue(null),
    diagnostics: vi.fn().mockResolvedValue([]),
    documentColors: vi.fn().mockResolvedValue([]),
    colorPresentations: vi.fn().mockResolvedValue([]),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as LanguageService;
}

describe("CodeMirrorLanguageService", () => {
  it("turns descriptions off without disabling diagnostics or suggestions, and can turn them back on", async () => {
    const service = mockService();
    service.hover = vi.fn().mockResolvedValue({ contents: "Symbol description" });
    const adapter = new CodeMirrorLanguageService(async () => service);
    const view = new EditorView({ state: EditorState.create({ doc: "x", extensions: adapter.extensions() }) });
    await adapter.syncEnvironment(environment);
    adapter.setDescriptionsEnabled(false);
    adapter.setDescriptionsEnabled(false);
    await expect((adapter as unknown as Internals).hover("x", 0)).resolves.toBeNull();
    expect(service.hover).not.toHaveBeenCalled();
    await (adapter as unknown as Internals).diagnostics("x");
    expect(service.diagnostics).toHaveBeenCalled();
    await (adapter as unknown as Internals).complete({
      state: view.state, pos: 1, matchBefore: () => ({ from: 0, to: 1, text: "x" }),
    } as unknown as CompletionContext);
    expect(service.completion).toHaveBeenCalled();
    adapter.setDescriptionsEnabled(true);
    expect(await (adapter as unknown as Internals).hover("x", 0)).not.toBeNull();
    view.destroy();
    adapter.dispose();
  });

  it("drops a pending description when descriptions are disabled", async () => {
    const service = mockService();
    let resolveHover: ((value: unknown) => void) | undefined;
    service.hover = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveHover = resolve;
    }));
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);
    const pending = (adapter as unknown as Internals).hover("x", 0);
    await vi.waitFor(() => expect(service.hover).toHaveBeenCalledOnce());
    adapter.setDescriptionsEnabled(false);
    resolveHover?.({ contents: "No longer wanted" });
    await expect(pending).resolves.toBeNull();
    adapter.dispose();
  });
  it("initializes, syncs its environment, and opens the live editor text before analysis", async () => {
    const service = mockService();
    const status = vi.fn();
    const adapter = new CodeMirrorLanguageService(async () => service, status);

    await adapter.syncEnvironment(environment);
    await (adapter as unknown as Internals).diagnostics("void main() {}");

    expect(status).toHaveBeenCalledWith("pending");
    expect(status).toHaveBeenCalledWith("ready");
    expect(service.initialize).toHaveBeenCalledOnce();
    expect(service.syncEnvironment).toHaveBeenCalledWith(expect.objectContaining({ documentUri: environment.documentUri }));
    expect(service.openDocument).toHaveBeenCalledWith(expect.objectContaining({ text: "void main() {}", version: 1 }));
  });

  it("returns empty language features until an environment is available and after disposal", async () => {
    const service = mockService();
    const adapter = new CodeMirrorLanguageService(async () => service);
    const state = EditorState.create({ doc: "x" });
    const context = { state, pos: 1, matchBefore: () => null } as unknown as CompletionContext;

    await expect((adapter as unknown as Internals).complete(context)).resolves.toBeNull();
    await expect((adapter as unknown as Internals).diagnostics("x")).resolves.toEqual([]);
    adapter.dispose();
    await expect((adapter as unknown as Internals).hover("x", 0)).resolves.toBeNull();
  });

  it("converts completion text edits and snippets to CodeMirror ranges", async () => {
    const service = mockService();
    service.completion = vi.fn().mockResolvedValue([{
      label: "texture",
      insertTextFormat: 2,
      textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: "texture(${1:sampler}, ${2:uv})" },
    }, {
      label: "texelFetch",
      textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: "texelFetch" },
    }]);
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);
    const state = EditorState.create({ doc: "te" });
    const context = {
      state,
      pos: 2,
      matchBefore: () => ({ from: 0, to: 2, text: "te" }),
    } as unknown as CompletionContext;

    const result = await (adapter as unknown as Internals).complete(context);

    expect(result?.from).toBe(0);
    expect(result?.options[0]).toMatchObject({ label: "texture" });
    expect(typeof result?.options[0].apply).toBe("function");
    const dispatch = vi.fn();
    const apply = result?.options[1].apply as (view: { dispatch: (spec: unknown) => void }) => void;
    apply({ dispatch });
    expect(dispatch).toHaveBeenCalledWith({ changes: { from: 0, to: 2, insert: "texelFetch" } });
  });

  it("wires the autocomplete extension into a live view", async () => {
    const service = mockService();
    service.completion = vi.fn().mockResolvedValue([{ label: "coord", kind: 6 }]);
    const adapter = new CodeMirrorLanguageService(async () => service);
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "co", extensions: [autocompletion({ override: [adapter.completionSource] }), ...adapter.extensions()] }), parent });
    await adapter.syncEnvironment(environment);

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => expect(service.completion).toHaveBeenCalledOnce());
    view.dispatch({ changes: { from: 2, insert: "x" } });
    view.destroy();
    parent.remove();
  });

  it("handles definition keyboard and pointer gestures without a browser coordinate", async () => {
    const service = mockService();
    const adapter = new CodeMirrorLanguageService(async () => service);
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "symbol", extensions: adapter.extensions() }), parent });
    await adapter.syncEnvironment(environment);

    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, ctrlKey: true, clientX: 1, clientY: 1 }));
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "F12" }));
    expect(service.definition).not.toHaveBeenCalled();
    view.destroy();
    parent.remove();
  });

  it("drops diagnostics which belong to a document superseded while analysis was running", async () => {
    const service = mockService();
    let resolveDiagnostics: ((value: unknown[]) => void) | undefined;
    service.diagnostics = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveDiagnostics = resolve;
      }))
      .mockResolvedValue([]);
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);

    const first = (adapter as unknown as Internals).diagnostics("old");
    await vi.waitFor(() => expect(service.diagnostics).toHaveBeenCalledOnce());
    const second = (adapter as unknown as Internals).diagnostics("new");
    resolveDiagnostics?.([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: "old", severity: 1 }]);

    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
  });

  it("contains language-service request failures", async () => {
    const service = mockService();
    service.completion = vi.fn().mockRejectedValue(new Error("completion failed"));
    service.hover = vi.fn().mockRejectedValue(new Error("hover failed"));
    service.diagnostics = vi.fn().mockRejectedValue(new Error("diagnostics failed"));
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);
    const state = EditorState.create({ doc: "x" });
    const context = { state, pos: 1, matchBefore: () => null } as unknown as CompletionContext;

    await expect((adapter as unknown as Internals).complete(context)).resolves.toBeNull();
    await expect((adapter as unknown as Internals).hover("x", 0)).resolves.toBeNull();
    await expect((adapter as unknown as Internals).diagnostics("x")).resolves.toEqual([]);
  });

  it("maps language-server diagnostic locations and severities", async () => {
    const service = mockService();
    service.diagnostics = vi.fn().mockResolvedValue([{
      range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
      message: { value: "bad expression" },
      severity: 2,
      source: "glsl",
    }]);
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);

    await expect((adapter as unknown as Internals).diagnostics("a\nbcde")).resolves.toEqual([
      expect.objectContaining({ from: 3, to: 5, severity: "warning", message: "bad expression" }),
    ]);
  });

  it("clamps malformed diagnostic positions to their source line", async () => {
    const service = mockService();
    service.diagnostics = vi.fn().mockResolvedValue([{
      range: { start: { line: -1, character: -4 }, end: { line: 0, character: 99 } },
      message: "bad range",
    }]);
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);

    await expect((adapter as unknown as Internals).diagnostics("one\ntwo")).resolves.toEqual([
      expect.objectContaining({ from: 0, to: 3, severity: "hint" }),
    ]);
  });

  it("keeps virtual and Common files in the environment sent to the service", async () => {
    const service = mockService();
    const adapter = new CodeMirrorLanguageService(async () => service);
    const withDependencies = {
      ...environment,
      commonFile: { uri: "shader://common.glsl", text: "float c;", version: 4 },
      virtualFiles: [{ uri: "shader://generated.glsl", text: "float v;", version: 5 }],
    };

    await adapter.syncEnvironment(withDependencies);

    expect(service.syncEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({
      commonFile: withDependencies.commonFile,
      virtualFiles: withDependencies.virtualFiles,
    }));
  });

  it("renders hover markdown as safe tooltip text", async () => {
    const service = mockService();
    service.hover = vi.fn().mockResolvedValue({
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
      contents: [{ language: "glsl", value: "vec3 color" }],
    });
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);

    const tooltip = await (adapter as unknown as Internals).hover("a bc", 2);

    expect(tooltip).toMatchObject({ pos: 1, end: 3 });
    expect(tooltip?.create(undefined as never).dom.textContent).toBe("vec3 color");
  });

  it("drops a hover response after the EditorView document changes", async () => {
    const service = mockService();
    let resolveHover: ((value: unknown) => void) | undefined;
    service.hover = vi.fn().mockImplementation(() => new Promise(resolve => {
      resolveHover = resolve;
    }));
    const adapter = new CodeMirrorLanguageService(async () => service);
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "old", extensions: adapter.extensions() }), parent });
    await adapter.syncEnvironment(environment);

    const pending = (adapter as unknown as Internals).hover("old", 1);
    await vi.waitFor(() => expect(service.hover).toHaveBeenCalledOnce());
    view.dispatch({ changes: { from: 0, to: 3, insert: "new" } });
    resolveHover?.({ contents: "stale" });

    await expect(pending).resolves.toBeNull();
    view.destroy();
    parent.remove();
  });

  it("navigates local definitions and delegates external definitions to the host", async () => {
    const service = mockService();
    const navigate = vi.fn();
    const adapter = new CodeMirrorLanguageService(async () => service, undefined, { onNavigate: navigate });
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "foo\nbar" }), parent });
    await adapter.syncEnvironment(environment);
    service.definition = vi.fn().mockResolvedValue([{ uri: environment.documentUri, range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } } }]);

    await (adapter as unknown as Internals).goDefinition(view, 1);
    expect(view.state.selection.main.head).toBe(5);

    service.definition = vi.fn().mockResolvedValue([{ uri: "shader://other.glsl", range: { start: { line: 2, character: 3 }, end: { line: 2, character: 4 } } }]);
    await (adapter as unknown as Internals).goDefinition(view, 1);
    expect(navigate).toHaveBeenCalledWith("shader://other.glsl", 2, 3);
    expect((adapter as unknown as Internals).startDefinition(view)).toBe(true);
    view.destroy();
    parent.remove();
  });

  it("closes the old document before switching to another URI", async () => {
    const service = mockService();
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);
    await (adapter as unknown as Internals).diagnostics("first");
    await adapter.syncEnvironment({ ...environment, documentUri: "shader://buffer.glsl", generation: 3 });

    expect(service.closeDocument).toHaveBeenCalledWith(environment.documentUri);
    await (adapter as unknown as Internals).diagnostics("second");
    expect(service.openDocument).toHaveBeenLastCalledWith(expect.objectContaining({ uri: "shader://buffer.glsl", version: 1 }));
  });

  it("disposes a service that finishes starting after the adapter was disposed", async () => {
    const service = mockService();
    let resolveFactory: ((service: LanguageService) => void) | undefined;
    const adapter = new CodeMirrorLanguageService(() => new Promise(resolve => {
      resolveFactory = resolve;
    }));

    adapter.dispose();
    await Promise.resolve();
    resolveFactory?.(service);
    await vi.waitFor(() => expect(service.dispose).toHaveBeenCalledOnce());
  });

  it("reports initialization failures and disposes a ready service", async () => {
    const status = vi.fn();
    const failed = new CodeMirrorLanguageService(async () => {
      throw new Error("worker unavailable");
    }, status);
    await expect(failed.syncEnvironment(environment)).rejects.toThrow("worker unavailable");
    expect(status).toHaveBeenCalledWith("error");

    const service = mockService();
    const adapter = new CodeMirrorLanguageService(async () => service);
    await adapter.syncEnvironment(environment);
    adapter.dispose();
    await Promise.resolve();
    expect(service.dispose).toHaveBeenCalledOnce();
  });
});
