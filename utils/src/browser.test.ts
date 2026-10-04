import { describe, expect, it } from 'vitest';
import { applySourceEdits } from './browser';

describe('browser utility exports', () => {
  it('applies offset-based shader edits through the browser package boundary', () => {
    expect(applySourceEdits('let x = 1;', [{ start: 8, end: 9, text: '2' }])).toEqual({ ok: true, source: 'let x = 2;' });
  });
});
