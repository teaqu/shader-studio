import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseAst } from 'rollup/parseAst';
import { compile } from 'svelte/compiler';

for (const generate of ['client', 'server']) {
  test(`Svelte emits valid ${generate} JavaScript for optional TypeScript parameters`, () => {
    const source = '<script lang="ts">function optional(value?: string) { return value; }</script><p>{optional()}</p>';
    const { js } = compile(source, { generate });
    assert.doesNotThrow(() => parseAst(js.code));
  });
}

for (const component of ['config/BufferConfig', 'config/PathInput', 'config/ChannelConfigModal', 'config/ComputePassControls', 'config/ScriptInfo', 'debug/ParameterEditor']) {
  test(`${component} makes initial prop snapshots explicit`, () => {
    const source = readFileSync(new URL(`../../ui/src/lib/components/${component}.svelte`, import.meta.url), 'utf8');
    const { warnings } = compile(source, { generate: 'client' });
    assert.deepEqual(warnings.filter(({ code }) => code === 'state_referenced_locally'), []);
  });
}
