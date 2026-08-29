import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  DiagnosticArbiter,
  DiagnosticSink,
  languageForPath,
  suppressDuplicateDiagnostics,
} from '../../app/DiagnosticArbiter';

function recordingSink(): DiagnosticSink & { latest: Map<string, vscode.Diagnostic[]>; cleared: number } {
  const latest = new Map<string, vscode.Diagnostic[]>();
  return {
    latest,
    cleared: 0,
    set(uri: vscode.Uri, diagnostics?: readonly vscode.Diagnostic[]) {
      latest.set(uri.fsPath, [...(diagnostics ?? [])]);
    },
    delete(uri: vscode.Uri) {
      latest.delete(uri.fsPath);
    },
    clear() {
      this.cleared += 1;
      latest.clear();
    },
  };
}

function error(line: number, message: string, character = 0): vscode.Diagnostic {
  return new vscode.Diagnostic(
    new vscode.Range(line, character, line, character + 4),
    message,
    vscode.DiagnosticSeverity.Error,
  );
}

function warning(line: number, message: string): vscode.Diagnostic {
  return new vscode.Diagnostic(
    new vscode.Range(line, 0, line, 4),
    message,
    vscode.DiagnosticSeverity.Warning,
  );
}

suite('DiagnosticArbiter Test Suite', () => {
  let compiler: ReturnType<typeof recordingSink>;
  let glsl: ReturnType<typeof recordingSink>;
  let slang: ReturnType<typeof recordingSink>;
  let arbiter: DiagnosticArbiter;

  setup(() => {
    compiler = recordingSink();
    glsl = recordingSink();
    slang = recordingSink();
    arbiter = new DiagnosticArbiter({ compiler, glsl, slang });
  });

  test('drops the renderer error a Slang language service already reported', () => {
    const uri = vscode.Uri.file('/shaders/image.slang');

    arbiter.languageServiceSink('slang').set(uri, [error(13, "undefined identifier 'stepp'", 14)]);
    arbiter.compilerSink().set(uri, [error(13, "Image: error[E30015]: undefined identifier 'stepp'")]);

    assert.deepStrictEqual(compiler.latest.get(uri.fsPath), []);
    assert.strictEqual(slang.latest.get(uri.fsPath)?.length, 1);
  });

  test('drops the Slang renderer error even when the compiler reported first', () => {
    const uri = vscode.Uri.file('/shaders/image.slang');

    arbiter.compilerSink().set(uri, [error(13, 'Image: error[E30015]: undefined identifier')]);
    assert.strictEqual(compiler.latest.get(uri.fsPath)?.length, 1, 'nothing to defer to yet');

    arbiter.languageServiceSink('slang').set(uri, [error(13, "undefined identifier 'stepp'", 14)]);

    assert.deepStrictEqual(compiler.latest.get(uri.fsPath), []);
  });

  test('drops the GLSL language service error the driver already reported', () => {
    const uri = vscode.Uri.file('/shaders/image.glsl');

    arbiter.compilerSink().set(uri, [error(4, "ERROR: 0:5: 'x' : undeclared identifier")]);
    arbiter.languageServiceSink('glsl').set(uri, [error(4, "Undefined identifier 'x'.")]);

    assert.strictEqual(compiler.latest.get(uri.fsPath)?.length, 1);
    assert.deepStrictEqual(glsl.latest.get(uri.fsPath), []);
  });

  test('keeps compiler errors no language service can see', () => {
    const uri = vscode.Uri.file('/shaders/image.slang');

    arbiter.languageServiceSink('slang').set(uri, [error(13, 'undefined identifier')]);
    arbiter.compilerSink().set(uri, [
      error(13, 'Image: error[E30015]: undefined identifier'),
      error(30, 'Image: link failed: iChannel0 unbound'),
    ]);

    const kept = compiler.latest.get(uri.fsPath);
    assert.strictEqual(kept?.length, 1);
    assert.ok(kept?.[0].message.includes('link failed'));
  });

  test('never lets a warning suppress an error, in either direction', () => {
    const slangUri = vscode.Uri.file('/shaders/image.slang');
    arbiter.languageServiceSink('slang').set(slangUri, [warning(2, 'unused uniform')]);
    arbiter.compilerSink().set(slangUri, [error(2, 'Image: error[E30015]: undefined identifier')]);
    assert.strictEqual(compiler.latest.get(slangUri.fsPath)?.length, 1);

    const glslUri = vscode.Uri.file('/shaders/image.glsl');
    arbiter.compilerSink().set(glslUri, [warning(2, 'Script: bundle failed')]);
    arbiter.languageServiceSink('glsl').set(glslUri, [error(2, "Undefined identifier 'x'.")]);
    assert.strictEqual(glsl.latest.get(glslUri.fsPath)?.length, 1);
  });

  test('keeps diagnostics on different lines of the same file', () => {
    const uri = vscode.Uri.file('/shaders/image.slang');

    arbiter.languageServiceSink('slang').set(uri, [error(13, 'undefined identifier')]);
    arbiter.compilerSink().set(uri, [error(20, 'Image: error[E20002]: syntax error')]);

    assert.strictEqual(compiler.latest.get(uri.fsPath)?.length, 1);
  });

  test('restores the suppressed report when the winning side goes quiet', () => {
    const uri = vscode.Uri.file('/shaders/image.slang');

    arbiter.languageServiceSink('slang').set(uri, [error(13, 'undefined identifier')]);
    arbiter.compilerSink().set(uri, [error(13, 'Image: error[E30015]: undefined identifier')]);
    assert.deepStrictEqual(compiler.latest.get(uri.fsPath), []);

    arbiter.languageServiceSink('slang').set(uri, []);

    assert.strictEqual(compiler.latest.get(uri.fsPath)?.length, 1, 'the compiler error is the only report left');
  });

  test('a language service delete releases its claim on the line', () => {
    const uri = vscode.Uri.file('/shaders/image.slang');

    arbiter.languageServiceSink('slang').set(uri, [error(13, 'undefined identifier')]);
    arbiter.compilerSink().set(uri, [error(13, 'Image: error[E30015]: undefined identifier')]);
    arbiter.languageServiceSink('slang').delete(uri);

    assert.strictEqual(compiler.latest.get(uri.fsPath)?.length, 1);
  });

  test('clearing a language service republishes every file it had claimed', () => {
    const first = vscode.Uri.file('/shaders/image.slang');
    const second = vscode.Uri.file('/shaders/buffer-a.slang');

    arbiter.languageServiceSink('slang').set(first, [error(13, 'undefined identifier')]);
    arbiter.languageServiceSink('slang').set(second, [error(7, 'undefined identifier')]);
    arbiter.compilerSink().set(first, [error(13, 'Image: error[E30015]: undefined identifier')]);
    arbiter.compilerSink().set(second, [error(7, 'BufferA: error[E30015]: undefined identifier')]);

    arbiter.languageServiceSink('slang').clear();

    assert.strictEqual(slang.cleared, 1);
    assert.strictEqual(compiler.latest.get(first.fsPath)?.length, 1);
    assert.strictEqual(compiler.latest.get(second.fsPath)?.length, 1);
  });

  test('clearing the compiler republishes the GLSL diagnostics it had suppressed', () => {
    const uri = vscode.Uri.file('/shaders/image.glsl');

    arbiter.compilerSink().set(uri, [error(4, "ERROR: 0:5: 'x' : undeclared identifier")]);
    arbiter.languageServiceSink('glsl').set(uri, [error(4, "Undefined identifier 'x'.")]);
    assert.deepStrictEqual(glsl.latest.get(uri.fsPath), []);

    arbiter.compilerSink().clear();

    assert.strictEqual(compiler.cleared, 1);
    assert.strictEqual(glsl.latest.get(uri.fsPath)?.length, 1);
  });

  test('keeps the two language collections apart', () => {
    const slangUri = vscode.Uri.file('/shaders/image.slang');

    arbiter.languageServiceSink('slang').set(slangUri, [error(1, 'slang problem')]);

    assert.strictEqual(slang.latest.get(slangUri.fsPath)?.length, 1);
    assert.strictEqual(glsl.latest.get(slangUri.fsPath), undefined);
  });

  suite('suppressDuplicateDiagnostics', () => {
    test('returns the loser untouched when the winner reported no errors', () => {
      const loser = [error(1, 'kept')];

      assert.deepStrictEqual(suppressDuplicateDiagnostics([warning(1, 'hint')], loser), loser);
      assert.deepStrictEqual(suppressDuplicateDiagnostics([], loser), loser);
    });

    test('suppresses by start line, not by exact range', () => {
      const result = suppressDuplicateDiagnostics([error(9, 'winner', 2)], [error(9, 'loser', 40)]);

      assert.deepStrictEqual(result, []);
    });
  });

  suite('languageForPath', () => {
    test('treats only .slang files as Slang, case-insensitively', () => {
      assert.strictEqual(languageForPath('/a/image.slang'), 'slang');
      assert.strictEqual(languageForPath('/a/IMAGE.SLANG'), 'slang');
      assert.strictEqual(languageForPath('/a/image.glsl'), 'glsl');
      assert.strictEqual(languageForPath('/a/image.frag'), 'glsl');
    });
  });
});
