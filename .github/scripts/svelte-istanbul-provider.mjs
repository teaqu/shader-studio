import istanbul from '@vitest/coverage-istanbul';
import { GenMapping, addMapping, setSourceContent, toEncodedMap } from '@jridgewell/gen-mapping';
import { TraceMap, eachMapping, originalPositionFor } from '@jridgewell/trace-mapping';
import { parse } from 'svelte/compiler';

/**
 * Svelte leaves its component mount unmapped when all script declarations vanish.
 * @param {string} code
 * @param {string} id
 * @param {import('@jridgewell/trace-mapping').EncodedSourceMap | undefined} sourceMap
 */
export function mapSvelteMount(code, id, sourceMap) {
  if (!id.split('?')[0].endsWith('.svelte') || !sourceMap?.sourcesContent) {
    return sourceMap;
  }
  const mount = /^\s*\$\.append\(\$\$anchor,[^\n]*;/m.exec(code);
  const source = sourceMap.sourcesContent[0];
  const sourceFile = sourceMap.sources[0];
  if (!mount || !source || !sourceFile) {
    return sourceMap;
  }
  const start = mount.index + mount[0].search(/\S/);
  const before = code.slice(0, start);
  const generated = { line: before.split('\n').length, column: start - before.lastIndexOf('\n') - 1 };
  const trace = new TraceMap(sourceMap);
  if (originalPositionFor(trace, generated).source !== null) {
    return sourceMap;
  }
  const template = parse(source, { modern: true }).fragment;
  const first = template.nodes.find((node) => node.type !== 'Text' || node.data.trim());
  const last = template.nodes.findLast((node) => node.type !== 'Text' || node.data.trim());
  if (!first || !last) {
    return sourceMap;
  }
  /** @param {number} offset */
  const position = (offset) => {
    const prefix = source.slice(0, offset);
    return { line: prefix.split('\n').length, column: offset - prefix.lastIndexOf('\n') - 1 };
  };
  const map = new GenMapping(sourceMap);
  eachMapping(trace, (mapping) => {
    const generated = { line: mapping.generatedLine, column: mapping.generatedColumn };
    if (mapping.source === null) {
      addMapping(map, { generated });
    } else {
      const mapped = {
        generated,
        source: mapping.source,
        original: { line: mapping.originalLine, column: mapping.originalColumn },
      };
      if (mapping.name === null) {
        addMapping(map, mapped);
      } else {
        addMapping(map, { ...mapped, name: mapping.name });
      }
    }
  });
  sourceMap.sources.forEach((file, index) => {
    if (file !== null) {
      setSourceContent(map, file, sourceMap.sourcesContent?.[index] ?? null);
    }
  });
  addMapping(map, { generated, source: sourceFile, original: position(first.start) });
  addMapping(map, {
    generated: { line: generated.line, column: generated.column + code.slice(start, mount.index + mount[0].length).length },
    source: sourceFile, original: position(last.end),
  });
  return toEncodedMap(map);
}

export default {
  ...istanbul,
  async getProvider() {
    const provider = await istanbul.getProvider();
    const transform = provider.onFileTransform;
    if (!transform) {
      throw new Error('Istanbul coverage provider does not implement source transformation');
    }
    provider.onFileTransform = (code, id, context) => transform.call(provider, code, id, {
      ...context,
      getCombinedSourcemap: () => mapSvelteMount(code, id, context.getCombinedSourcemap()),
    });
    return provider;
  },
};
