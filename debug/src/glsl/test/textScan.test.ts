import { describe, expect, it } from 'vitest';
import { parenthesizedContents, stripLineComment } from '../textScan';

describe('GLSL text scanning', () => {
  it('strips adversarial line-comment input in linear time', () => {
    const prefix = '/'.repeat(200_000);
    expect(stripLineComment(`${prefix}// hidden`)).toBe('');
  });

  it('extracts nested parameter text without regex backtracking', () => {
    const nested = '('.repeat(10_000);
    const closing = ')'.repeat(10_000);
    expect(parenthesizedContents(`fn(${nested}value${closing}) tail`))
      .toBe(`${nested}value${closing}`);
  });
});
