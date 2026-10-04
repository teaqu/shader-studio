import { describe, expect, it } from 'vitest';
import * as browserUtils from '../browser';

describe('browser utility entry point', () => {
  it('provides source edits and HTML port injection without filesystem helpers', () => {
    expect(browserUtils.applySourceEdits('abc', [{ start: 1, end: 2, text: 'X' }])).toEqual({ ok: true, source: 'aXc' });
    expect(browserUtils.injectPortIntoHtml('<head></head>', 4321)).toContain('port: 4321');
    expect(browserUtils).not.toHaveProperty('collectSlangDependencies');
  });
});
