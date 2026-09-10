import { describe, expect, it } from 'vitest';
import { applyTextEdits } from '../language-services/workspaceEdits';

const range = (start: number, end: number) => ({ start: { line: 0, character: start }, end: { line: 0, character: end } });
describe('workspace text edits', () => {
  it.each(['glsl', 'slang', 'wgsl'])('applies every %s edit against the same original snapshot', () => {
    expect(applyTextEdits('tone(tone)', [{ range: range(0, 4), newText: 'curve' }, { range: range(5, 9), newText: 'curve' }])).toBe('curve(curve)');
  });
  it('uses UTF-16 positions and preserves CRLF', () => {
    expect(applyTextEdits('// 😀\r\ntone', [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: 'curve' }])).toBe('// 😀\r\ncurve');
  });
  it.each([
    [{ range: range(0, 4), newText: 'x' }, { range: range(2, 4), newText: 'y' }],
    [{ range: range(0, 20), newText: 'x' }],
    [{ range: range(3, 1), newText: 'x' }],
    [{ range: range(-1, 1), newText: 'x' }],
    [{ range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } }, newText: 'x' }],
  ])('rejects invalid edits before applying anything: %j', (...edits) => {
    expect(() => applyTextEdits('tone', edits)).toThrow();
  });
});
