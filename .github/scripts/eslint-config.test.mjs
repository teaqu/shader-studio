import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

test('ESLint parses TypeScript in Svelte rune modules', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    'interface Counter { value: number }\nconst counter: Counter = $state({ value: 0 });\nexport const getValue = () => counter.value;\n',
    { filePath: 'ui/src/lib/state/lintFixture.svelte.ts' },
  );
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});
