import path from 'node:path';

/** Require an installed extension to be a descendant, not a prefix sibling. */
export function isWithinDirectory(directory, file, paths = path) {
  const relative = paths.relative(directory, file);
  return relative.length > 0 && !paths.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${paths.sep}`);
}

/** Monaco preserves the active document's EOL when handling a paste. */
export function sourceForDocument(source, eol) {
  return source.replace(/\r?\n/g, eol === 2 ? '\r\n' : '\n');
}
