import { expect, it } from 'vitest';
import { compile } from 'svelte/compiler';
import { TraceMap, eachMapping, originalPositionFor, type EncodedSourceMap } from '@jridgewell/trace-mapping';
// Node-only coverage tooling intentionally lives outside application source.
import { mapSvelteMount } from '../../../.github/scripts/svelte-istanbul-provider.mjs';

it('maps a props-only component mount to its real template span', () => {
  const source = '<script>let { title } = $props();</script>\n<div>{title}</div>';
  const output = compile(source, { filename: 'Alert.svelte', generate: 'client' }).js;
  const index = output.code.indexOf('$.append($$anchor,');
  const prefix = output.code.slice(0, index);
  const location = { line: prefix.split('\n').length, column: index - prefix.lastIndexOf('\n') - 1 };
  expect(originalPositionFor(new TraceMap(JSON.parse(output.map.toString()) as EncodedSourceMap), location).source).toBeNull();
  const repaired = mapSvelteMount(output.code, 'Alert.svelte', JSON.parse(output.map.toString()) as EncodedSourceMap);
  if (!repaired) {
    throw new Error('Expected the compiled source map');
  }
  expect(originalPositionFor(new TraceMap(repaired), location)).toMatchObject({ line: 2, column: 0 });
  expect(originalPositionFor(new TraceMap(repaired), { ...location, column: location.column + output.code.slice(index).split('\n')[0].length })).toMatchObject({ line: 2, column: 18 });
  eachMapping(new TraceMap(JSON.parse(output.map.toString()) as EncodedSourceMap), (mapping) => {
    expect(originalPositionFor(new TraceMap(repaired), { line: mapping.generatedLine, column: mapping.generatedColumn })).toEqual({
      source: mapping.source, line: mapping.originalLine, column: mapping.originalColumn, name: mapping.name,
    });
  });
  expect(repaired.sourcesContent).toEqual(output.map.sourcesContent);
});

it('preserves the source mappings for reactive branches and event handlers', () => {
  const source = '<script>let show = $state(false); function toggle() { show = !show; }</script>\n<button onclick={toggle}>Toggle</button>{#if show}<p>Visible</p>{/if}';
  const output = compile(source, { filename: 'Interactive.svelte', generate: 'client' }).js;
  const map = mapSvelteMount(output.code, 'Interactive.svelte', JSON.parse(output.map.toString()) as EncodedSourceMap);
  if (!map) {
    throw new Error('Expected the compiled source map');
  }
  const repaired = new TraceMap(map);
  const original = new TraceMap(JSON.parse(output.map.toString()) as EncodedSourceMap);
  eachMapping(original, (mapping) => {
    const position = { line: mapping.generatedLine, column: mapping.generatedColumn };
    // Multiple segments can share a generated position in newer Svelte output.
    // Preserve the mapping a consumer resolves, rather than each raw segment.
    expect(originalPositionFor(repaired, position)).toEqual(originalPositionFor(original, position));
  });
});

it('preserves other modules, empty templates and missing source maps', () => {
  const source = '<script>let { title } = $props();</script>';
  const output = compile(source, { filename: 'Empty.svelte', generate: 'client' }).js;
  expect(mapSvelteMount(output.code, 'Empty.svelte', JSON.parse(output.map.toString()) as EncodedSourceMap)).toEqual(JSON.parse(output.map.toString()));
  expect(mapSvelteMount(output.code, 'module.ts', JSON.parse(output.map.toString()) as EncodedSourceMap)).toEqual(JSON.parse(output.map.toString()));
  expect(mapSvelteMount(output.code, 'Empty.svelte', undefined)).toBeUndefined();
});
