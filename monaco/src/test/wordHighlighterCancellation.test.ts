import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
// The patch runs in Node during installation, before any browser bundle is built.
// @ts-expect-error The installation script is plain JavaScript.
import { patchWordHighlighter, resolveWordHighlighterPath } from '../../scripts/patch-word-highlighter.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(resolveWordHighlighterPath(require), 'utf8');

describe('Monaco word-highlighter cancellation', () => {
  it.each([0, 1, 2])('handles the delayed highlight rejection at call site %s', async index => {
    const statement = patchWordHighlighter(source).match(/this\.runDelayer\.trigger\([^\n]+/g)[index];
    const onUnexpectedError = vi.fn();
    const error = new Error('Canceled');
    // Track rejection handling without leaking a deliberately unhandled promise
    // into Vitest. Monaco owns the real cancellation-aware error handler.
    const promise = { catch: vi.fn(handler => handler(error)) };
    const target = { runDelayer: { trigger: vi.fn(() => promise) } };
    new Function('onUnexpectedError', 'e', 'delay', statement).call(target, onUnexpectedError, {}, 50);
    expect(promise.catch).toHaveBeenCalledWith(onUnexpectedError);
    expect(onUnexpectedError).toHaveBeenCalledWith(error);
  });
  it('is idempotent and refuses an unrecognized implementation', () => {
    const patched = patchWordHighlighter(source);
    expect(patchWordHighlighter(patched)).toBe(patched);
    expect(() => patchWordHighlighter('changed upstream implementation')).toThrow(/word.highlighter/i);
  });
  it('accepts Monaco implementations that already handle cancelled delays', () => {
    const handled = `this.runDelayer.trigger(() => { this._onPositionChanged(e); }).catch(onUnexpectedError);
this.runDelayer.trigger(() => { this._run(); }).catch(onUnexpectedError);
this.runDelayer.trigger(() => { this._run(false, delay); }).catch(onUnexpectedError);`;
    expect(patchWordHighlighter(handled)).toBe(handled);
  });
  it('tries both Monaco package layouts', () => {
    const oldLayout = 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
    const resolve = vi.fn((candidate: string) => {
      if (candidate === oldLayout) {
        return '/old/wordHighlighter.js';
      }
      throw Object.assign(new Error('missing'), { code: 'MODULE_NOT_FOUND' });
    });
    expect(resolveWordHighlighterPath({ resolve })).toBe('/old/wordHighlighter.js');
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
