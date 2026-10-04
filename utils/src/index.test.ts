import { expect, it } from 'vitest';
import { applySourceEdits, collectSlangDependencies, injectPortIntoHtml } from './index';

it('evaluates the public utility module and forwards its exported contracts', () => {
  expect(applySourceEdits('abc', [{ start: 1, end: 2, text: 'X' }])).toEqual({ ok: true, source: 'aXc' });
  expect(injectPortIntoHtml('<head></head>', 4321)).toContain('port: 4321');
  expect(collectSlangDependencies).toBeTypeOf('function');
});
