import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pull request CI workspace dependencies', () => {
  it('builds runtime package entries before running the workspace tests', () => {
    const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/test.yml', import.meta.url)), 'utf8');
    const build = workflow.indexOf('run: npm run build -w types -w utils -w slang-debug');
    const tests = workflow.indexOf('run: npm test');

    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(tests);
  });
});
