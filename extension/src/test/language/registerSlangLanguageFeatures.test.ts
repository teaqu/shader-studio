import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  registerSlangLanguageFeatures,
  SLANG_DOCUMENT_SELECTOR,
  type SlangLanguageClientContract,
  toCompletionItem,
  toDiagnostic,
  toDocumentSymbol,
  toHover,
  toLocation,
  toSignatureHelp,
} from "../../language/registerSlangLanguageFeatures";

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for language feature operation");
}

suite("Slang language feature adapter", () => {
  test("uses exactly a file Slang selector", () => {
    assert.deepStrictEqual(SLANG_DOCUMENT_SELECTOR, [{ language: "slang", scheme: "file" }]);
  });

  test("converts zero-based shared DTO ranges at the VS Code boundary", () => {
    const range = { start: { line: 2, character: 3 }, end: { line: 4, character: 5 } };
    const hover = toHover({ contents: { kind: "markdown", value: "hello" }, range });
    const location = toLocation({ uri: "file:///workspace/helper.slang", range });
    const diagnostic = toDiagnostic({ code: "12", severity: 1, message: "bad", range });

    assert.deepStrictEqual(hover?.range, new vscode.Range(2, 3, 4, 5));
    assert.deepStrictEqual(location.range, new vscode.Range(2, 3, 4, 5));
    assert.deepStrictEqual(diagnostic.range, new vscode.Range(2, 3, 4, 5));
    assert.strictEqual(diagnostic.source, "Slang");
  });

  test("converts completion resolution, signature help, and nested symbols", () => {
    const range = { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } };
    const completion = toCompletionItem({
      label: "float4", kind: 7, detail: "type", data: "key",
      documentation: { kind: "markdown", value: "docs" },
      textEdit: { range, text: "float4" }, commitCharacters: ["("],
    });
    const signature = toSignatureHelp({
      signatures: [{ label: "f(float x)", documentation: { kind: "plaintext", value: "d" }, parameters: [{ label: [2, 9], documentation: { kind: "plaintext", value: "p" } }] }],
      activeSignature: 0, activeParameter: 0,
    });
    const symbol = toDocumentSymbol({
      name: "mainImage", detail: "function", kind: 11, range, selectionRange: range,
      children: [{ name: "uv", detail: "variable", kind: 12, range, selectionRange: range, children: [] }],
    });

    assert.strictEqual(completion.insertText, "float4");
    assert.strictEqual(signature.signatures[0]?.parameters[0]?.label, "float x");
    assert.strictEqual(symbol.children.length, 1);
  });

  test("is idempotent and does not create providers, diagnostics, or a worker while disabled", () => {
    const sandbox = sinon.createSandbox();
    try {
      sandbox.stub(vscode.workspace, "getConfiguration").returns({ get: () => false } as unknown as vscode.WorkspaceConfiguration);
      const configurationListener = sandbox.stub(vscode.workspace, "onDidChangeConfiguration").returns(new vscode.Disposable(() => undefined));
      const diagnosticFactory = sandbox.stub(vscode.languages, "createDiagnosticCollection");
      const createClient = sandbox.stub();
      const context = { extensionPath: "/extension", subscriptions: [] } as unknown as vscode.ExtensionContext;

      const first = registerSlangLanguageFeatures(context, { createClient });
      const second = registerSlangLanguageFeatures(context, { createClient });

      assert.strictEqual(first, second);
      assert.strictEqual(configurationListener.callCount, 1);
      assert.strictEqual(diagnosticFactory.callCount, 0);
      assert.strictEqual(createClient.callCount, 0);
      first.dispose();
    } finally {
      sandbox.restore();
    }
  });

  test("forwards document lifecycle, publishes isolated diagnostics, and disposes on disable", async () => {
    const sandbox = sinon.createSandbox();
    let enabled = true;
    let configurationListener: ((event: vscode.ConfigurationChangeEvent) => void) | undefined;
    let openListener: ((document: vscode.TextDocument) => void) | undefined;
    let changeListener: ((event: vscode.TextDocumentChangeEvent) => void) | undefined;
    let closeListener: ((document: vscode.TextDocument) => void) | undefined;
    const providerDisposals: sinon.SinonSpy[] = [];
    const disposable = (): vscode.Disposable => {
      const dispose = sandbox.spy();
      providerDisposals.push(dispose);
      return { dispose };
    };
    const diagnosticSet = sandbox.spy();
    const diagnosticDelete = sandbox.spy();
    const diagnosticClear = sandbox.spy();
    const diagnosticCollection = {
      name: "shader-studio-slang",
      set: diagnosticSet,
      delete: diagnosticDelete,
      clear: diagnosticClear,
      dispose: sandbox.spy(),
      forEach: sandbox.spy(),
      get: sandbox.stub(),
      has: sandbox.stub(),
    } as unknown as vscode.DiagnosticCollection;
    const client = {
      init: sandbox.stub().resolves(),
      replaceFiles: sandbox.stub().resolves(),
      openDocument: sandbox.stub().resolves(),
      changeDocument: sandbox.stub().resolves(),
      closeDocument: sandbox.stub().resolves(),
      hover: sandbox.stub().resolves(undefined),
      definition: sandbox.stub().resolves(undefined),
      completion: sandbox.stub().resolves(undefined),
      completionResolve: sandbox.stub().resolves(undefined),
      signatureHelp: sandbox.stub().resolves(undefined),
      documentSymbols: sandbox.stub().resolves(undefined),
      diagnostics: sandbox.stub().resolves([{
        code: "30000",
        severity: 1,
        message: "broken",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      }]),
      dispose: sandbox.spy(),
    } satisfies SlangLanguageClientContract;
    const root = vscode.Uri.file("/tmp/slang-feature-test");
    const document = {
      uri: vscode.Uri.joinPath(root, "new.slang"),
      languageId: "slang",
      version: 7,
      getText: () => "module new_shader;",
    } as unknown as vscode.TextDocument;
    const openDocuments: vscode.TextDocument[] = [];
    try {
      sandbox.stub(vscode.workspace, "getConfiguration").returns({ get: () => enabled } as unknown as vscode.WorkspaceConfiguration);
      sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: root, name: "test", index: 0 }]);
      sandbox.stub(vscode.workspace, "textDocuments").value(openDocuments);
      sandbox.stub(vscode.workspace, "findFiles").resolves([]);
      sandbox.stub(vscode.workspace, "onDidChangeConfiguration").callsFake((listener) => {
        configurationListener = listener;
        return disposable();
      });
      sandbox.stub(vscode.workspace, "onDidOpenTextDocument").callsFake((listener) => {
        openListener = listener;
        return disposable();
      });
      sandbox.stub(vscode.workspace, "onDidChangeTextDocument").callsFake((listener) => {
        changeListener = listener;
        return disposable();
      });
      sandbox.stub(vscode.workspace, "onDidCloseTextDocument").callsFake((listener) => {
        closeListener = listener;
        return disposable();
      });
      sandbox.stub(vscode.languages, "createDiagnosticCollection").callsFake((name) => {
        assert.strictEqual(name, "shader-studio-slang");
        assert.notStrictEqual(name, "shader-studio");
        return diagnosticCollection;
      });
      sandbox.stub(vscode.languages, "registerCompletionItemProvider").returns(disposable());
      sandbox.stub(vscode.languages, "registerHoverProvider").returns(disposable());
      sandbox.stub(vscode.languages, "registerDefinitionProvider").returns(disposable());
      sandbox.stub(vscode.languages, "registerSignatureHelpProvider").returns(disposable());
      sandbox.stub(vscode.languages, "registerDocumentSymbolProvider").returns(disposable());
      const context = { extensionPath: "/extension", subscriptions: [] } as unknown as vscode.ExtensionContext;
      const registration = registerSlangLanguageFeatures(context, { createClient: () => client });
      await waitUntil(() => client.init.calledOnce);

      openDocuments.push(document);
      openListener?.(document);
      await waitUntil(() => client.openDocument.calledOnce && diagnosticSet.calledOnce);
      assert.strictEqual(client.replaceFiles.callCount, 1, "new files are added to the worker snapshot before opening");
      assert.strictEqual(diagnosticSet.firstCall.args[0].toString(), document.uri.toString());

      changeListener?.({ document } as vscode.TextDocumentChangeEvent);
      await waitUntil(() => client.changeDocument.calledOnce);
      openDocuments.splice(0);
      closeListener?.(document);
      await waitUntil(() => client.closeDocument.calledOnce && diagnosticDelete.calledOnce);

      enabled = false;
      configurationListener?.({ affectsConfiguration: () => true });
      assert.strictEqual(client.dispose.callCount, 1);
      assert.strictEqual(diagnosticClear.callCount, 1);
      assert.strictEqual(
        providerDisposals.filter((dispose) => dispose.called).length,
        providerDisposals.length - 1,
        "all provider and document listeners dispose while the configuration listener remains active",
      );
      registration.dispose();
    } finally {
      sandbox.restore();
    }
  });
});
