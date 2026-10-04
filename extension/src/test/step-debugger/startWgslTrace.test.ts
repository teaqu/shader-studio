import * as assert from 'assert';
import proxyquire = require('proxyquire');

suite('start inspected WGSL pixel trace', () => {
  const payload = { program: '/image.wgsl', source: 'source', width: 4, height: 4,
    pixel: [1, 2], time: 0, frame: 0, capacity: 64 };

  function rig(options: { active?: boolean; source?: string; started?: boolean; failure?: boolean } = {}) {
    const launches: unknown[] = [];
    const errors: string[] = [];
    const opened: unknown[] = [];
    const document = { uri: { fsPath: payload.program }, getText: () => options.source ?? 'source' };
    const mock = {
      debug: {
        activeDebugSession: options.active ? { type: 'shader-studio-wgsl-trace' } : undefined,
        startDebugging: async (...args: unknown[]) => {
          launches.push(args);
          if (options.failure) {
            throw new Error('GPU startup failed'); 
          }
          return options.started ?? true;
        },
      },
      Uri: { file: (path: string) => ({ fsPath: path }) },
      workspace: { openTextDocument: async () => document, getWorkspaceFolder: () => 'folder' },
      window: { showTextDocument: async (...args: unknown[]) => {
        opened.push(args); 
      },
      showErrorMessage: async (message: string) => {
        errors.push(message); 
      } },
      '@noCallThru': true,
    };
    const { startWgslTrace } = proxyquire('../../step-debugger/startWgslTrace', { vscode: mock });
    return { start: (request: unknown = payload) => startWgslTrace(request), launches, errors, opened };
  }

  test('opens the source and starts a VS Code trace from the preview request', async () => {
    const test = rig(); await test.start();
    assert.strictEqual(test.opened.length, 1);
    assert.strictEqual(test.launches.length, 1);
    assert.deepStrictEqual(test.errors, []);
  });

  test('reports an active trace, stale source, invalid payload and failed launches', async () => {
    for (const options of [{ active: true }, { source: 'different' }, { started: false }, { failure: true }]) {
      const test = rig(options); await test.start();
      assert.strictEqual(test.errors.length, 1);
      if (options.active || options.source) {
        assert.strictEqual(test.launches.length, 0); 
      }
    }
    const invalid = rig(); await invalid.start(null);
    assert.strictEqual(invalid.errors.length, 1);
    assert.strictEqual(invalid.opened.length, 0);
  });
});
