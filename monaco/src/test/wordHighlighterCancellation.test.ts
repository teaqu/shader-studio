import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
// The patch runs in Node during installation, before any browser bundle is built.
// @ts-expect-error The installation script is plain JavaScript.
import { patchWordHighlighter } from '../../scripts/patch-word-highlighter.mjs';

const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve('monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js'), 'utf8');

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
});
