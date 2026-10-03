import * as assert from 'assert';
import proxyquire = require('proxyquire');
import type { WgslTraceRecording } from '@shader-studio/types';

interface DocumentState {
  path: string;
  source: string;
  version: number;
}

suite('WGSL project trace host', () => {
  const root = '/project/image.wgsl';
  const common = '/project/common.wgsl';
  const recording: WgslTraceRecording = {
    path: root,
    source: 'fn mainImage() {}',
    sources: [{ path: common, source: 'fn helper() {}' }],
    color: [0, 0, 0, 1], overflow: false,
    sites: [{ id: 0, path: common, functionName: 'helper', line: 1, column: 1, variables: [] }],
    events: [{ siteId: 0, path: common, functionName: 'helper', line: 1, column: 1, values: [] }],
  };

  function rig(options: { deferredDependency?: boolean } = {}) {
    const states = new Map<string, DocumentState>([
      [root, { path: root, source: recording.source, version: 1 }],
      [common, { path: common, source: recording.sources![0]!.source, version: 1 }],
    ]);
    let resolveDependency: (() => void) | undefined;
    const createdPanels: unknown[][] = [];
    const mock = {
      Uri: { file: (path: string) => ({ fsPath: path }), joinPath: () => ({}) },
      ViewColumn: { Beside: 2 },
      Disposable: class {
        dispose() {}
      },
      workspace: {
        openTextDocument: async (uri: { fsPath: string }) => {
          if (options.deferredDependency && uri.fsPath === common) {
            await new Promise<void>(resolve => {
              resolveDependency = resolve;
            });
          }
          const state = states.get(uri.fsPath)!;
          return {
            uri: { fsPath: state.path },
            getText: () => state.source,
            get version() {
              return state.version;
            },
          };
        },
      },
      window: { createWebviewPanel: (...args: unknown[]) => {
        createdPanels.push(args);
        return {};
      } },
      '@noCallThru': true,
    };
    const { WgslTraceHost } = proxyquire('../../step-debugger/WgslTraceHost', { vscode: mock });
    const host = new WgslTraceHost({ extensionUri: {} } as never);
    const configuration = { program: root, source: recording.source, recording };
    return { host, configuration, states, createdPanels, resolveDependency: () => resolveDependency?.() };
  }

  test('accepts a frozen project recording without creating another GPU runner panel', async () => {
    const test = rig();
    const captured = await test.host.capture(test.configuration);
    assert.strictEqual(captured, recording);
    assert.strictEqual(test.createdPanels.length, 0);
    assert.strictEqual(test.host.sourceIsCurrent(), true);
  });

  test('rejects stale preview, recording-root, and dependency source snapshots', async () => {
    const stalePreview = rig();
    stalePreview.states.get(root)!.source = 'edited';
    await assert.rejects(stalePreview.host.capture(stalePreview.configuration), /preview shader differs/);
    const staleRoot = rig();
    await assert.rejects(staleRoot.host.capture({ ...staleRoot.configuration,
      recording: { ...recording, source: 'older snapshot' } }), /project recording differs/);
    const staleDependency = rig();
    staleDependency.states.get(common)!.source = 'edited helper';
    await assert.rejects(staleDependency.host.capture(staleDependency.configuration), /dependency .* changed/);
    assert.strictEqual(staleDependency.createdPanels.length, 0);
  });

  test('invalidates a native recording when any captured dependency changes', async () => {
    const test = rig();
    await test.host.capture(test.configuration);
    test.states.get(common)!.version += 1;
    test.states.get(common)!.source = 'changed';
    assert.strictEqual(test.host.sourceIsCurrent(), false);
  });

  test('cancels an in-flight native recording before it can resolve', async () => {
    const test = rig({ deferredDependency: true });
    const pending = test.host.capture(test.configuration);
    await Promise.resolve();
    test.host.dispose();
    test.resolveDependency();
    await assert.rejects(pending, /cancelled/);
    assert.strictEqual(test.createdPanels.length, 0);
  });
});
