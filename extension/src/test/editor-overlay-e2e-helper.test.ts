import * as assert from 'assert';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface Host {
  shaderFrame(): Promise<unknown>;
  evaluateInHost(callback: unknown): Promise<void>;
}

suite('Overlay E2E readiness', () => {
  let openEditorOverlay: (host: Host) => Promise<unknown>;
  suiteSetup(async () => {
    const url = pathToFileURL(path.resolve(__dirname, '../../e2e/pw/editor-overlay.mjs')).href;
    ({ openEditorOverlay } = await import(url));
  });

  const fixture = (visible: boolean, ready: Promise<void>) => {
    const calls: string[] = [];
    const frame = {
      locator: (selector: string) => ({
        count: async () => selector === '.editor-overlay' && visible ? 1 : 0,
        waitFor: async () => {
          calls.push(selector);
          if (selector.includes(':enabled')) {
            await ready;
          }
        },
      }),
    };
    const host: Host = {
      shaderFrame: async () => frame,
      evaluateInHost: async () => {
        calls.push('toggle');
      },
    };
    return { calls, host, frame };
  };

  test('waits for shader controls before sending a command the empty viewer would ignore', async () => {
    let release!: () => void;
    const ready = new Promise<void>(resolve => {
      release = resolve;
    });
    const { calls, host, frame } = fixture(false, ready);
    const opened = openEditorOverlay(host);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepStrictEqual(calls, ['button[aria-label="Reset shader"]:enabled']);
    release();
    assert.strictEqual(await opened, frame);
    assert.deepStrictEqual(calls, [
      'button[aria-label="Reset shader"]:enabled', 'toggle', '.editor-overlay .monaco-editor',
    ]);
  });

  test('does not close an overlay whose Monaco editor is still mounting', async () => {
    const { calls, host } = fixture(true, Promise.resolve());
    await openEditorOverlay(host);
    assert.ok(!calls.includes('toggle'));
    assert.strictEqual(calls.at(-1), '.editor-overlay .monaco-editor');
  });
});
