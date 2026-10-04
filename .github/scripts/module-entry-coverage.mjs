import ts from 'typescript';
import { addMapping, toEncodedMap } from '@jridgewell/gen-mapping';
import { copyCoverageMap } from './coverage-source-maps.mjs';

/**
 * Istanbul omits import/export declarations from statement coverage. Record
 * each runtime re-export boundary when its module is evaluated, using normal
 * Istanbul counters in test-only code. An unimported barrel retains zero hits.
 * @param {string} code
 * @param {string} id
 * @param {import('@jridgewell/trace-mapping').EncodedSourceMap | import('@jridgewell/gen-mapping').EncodedSourceMap | undefined} sourceMap
 */
export function instrumentBarrelEntries(code, id, sourceMap) {
  const unchanged = { code, map: sourceMap };
  if (!id.split('?')[0].endsWith('.ts') || !sourceMap?.sourcesContent?.[0] || !sourceMap.sources[0]) {
    return unchanged;
  }
  const source = sourceMap.sourcesContent[0];
  const sourceFile = sourceMap.sources[0];
  const emitted = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext,
  } }).outputText;
  const runtime = ts.createSourceFile(id, emitted, ts.ScriptTarget.Latest, true);
  if (!runtime.statements.every((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) {
    return unchanged;
  }
  /** @param {import('typescript').Node} node */
  const isRuntimeExport = (node) => ts.isExportDeclaration(node) && !node.isTypeOnly
    && (!node.exportClause || !ts.isNamedExports(node.exportClause)
      || node.exportClause.elements.some((specifier) => !specifier.isTypeOnly));
  if (!runtime.statements.some(isRuntimeExport)) {
    return unchanged;
  }
  const original = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true);
  const exports = original.statements.filter(isRuntimeExport);
  const map = copyCoverageMap(sourceMap, exports.length);
  exports.forEach((node, index) => {
    for (const [column, offset] of [[0, node.getStart(original)], [7, node.end]]) {
      const position = original.getLineAndCharacterOfPosition(offset);
      addMapping(map, { generated: { line: index + 1, column }, source: sourceFile,
        original: { line: position.line + 1, column: position.character } });
    }
  });
  return { code: 'void 0;\n'.repeat(exports.length) + code, map: toEncodedMap(map) };
}
