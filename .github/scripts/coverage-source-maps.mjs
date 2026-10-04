import { GenMapping, addMapping, setSourceContent } from '@jridgewell/gen-mapping';
import { TraceMap, eachMapping } from '@jridgewell/trace-mapping';

/**
 * @param {import('@jridgewell/trace-mapping').EncodedSourceMap | import('@jridgewell/gen-mapping').EncodedSourceMap} sourceMap
 * @param {number} lineOffset
 */
export function copyCoverageMap(sourceMap, lineOffset = 0) {
  const map = new GenMapping(sourceMap);
  eachMapping(new TraceMap(sourceMap), (mapping) => {
    const generated = { line: mapping.generatedLine + lineOffset, column: mapping.generatedColumn };
    if (mapping.source === null) {
      addMapping(map, { generated });
    } else {
      const mapped = { generated, source: mapping.source, original: { line: mapping.originalLine, column: mapping.originalColumn } };
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
  return map;
}
