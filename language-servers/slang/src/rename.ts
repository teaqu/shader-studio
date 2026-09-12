import { parseGlslDocument, visibleSymbolsAtPosition, type GlslSymbol } from "@shader-studio/glsl-analysis";
import { SHADER_STUDIO_SYMBOL_DOCS, type ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { Position, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol";

export interface SlangRenameDocument {
  readonly uri: string;
  readonly text: string;
  readonly environment: ShaderAuthoringEnvironment;
}

export function applySlangRenameEdits(source: string, edits: readonly TextEdit[]): string {
  return [...edits].sort((a, b) => offsetAt(source, b.range.start)! - offsetAt(source, a.range.start)!)
    .reduce((text, edit) => text.slice(0, offsetAt(source, edit.range.start)!) + edit.newText + text.slice(offsetAt(source, edit.range.end)!), source);
}
interface Point { uri: string; offset: number }
interface Occurrence extends Point { name: string; member: boolean }
interface Binding { name: string; kind: GlslSymbol['kind']; declaration: Point; references: Map<string, Point> }
interface Analysis {
  bindings: Map<string, Binding>;
  occurrences: Map<string, Occurrence>;
  visibleNames: Map<string, Set<string>>;
}
interface Edit { start: number; end: number; newText: string }

export interface SlangResolvedSymbol {
  readonly declaration: Point;
  readonly references: readonly Point[];
}

/** Resolve authored references with the same conservative graph used by rename. */
export function resolveSlangSymbol(documents: readonly SlangRenameDocument[], uri: string, position: Position): SlangResolvedSymbol | null {
  const commonUri = documents.find(document => document.uri === uri)?.environment.commonFile?.uri ?? uri;
  const scoped = documents.filter(document => document.uri === uri || document.uri === commonUri || document.environment.commonFile?.uri === commonUri);
  const sources = collectSources(scoped);
  const source = sources.get(uri);
  const offset = source === undefined ? undefined : offsetAt(source, position);
  if (source === undefined || offset === undefined) {
    return null;
  }
  const cursor = !/[A-Za-z0-9_]/.test(source[offset] ?? '') && /[A-Za-z0-9_]/.test(source[offset - 1] ?? '') ? offset - 1 : offset;
  const analysis = analyze(scoped, sources);
  if (!analysis) {
    return null;
  }
  const binding = [...analysis.bindings.values()].find(candidate => [candidate.declaration, ...candidate.references.values()]
    .some(point => point.uri === uri && cursor >= point.offset && cursor < point.offset + candidate.name.length));
  return binding ? { declaration: binding.declaration, references: [...binding.references.values()] } : null;
}

/**
 * Slang's browser compiler exposes no usable reference index. For its C-like
 * syntax, reuse the scoped AST resolver with numeric type spelling conversion.
 * Unsupported syntax is declined; recovery/name-only edits are never used.
 * Reparse the proposed edit and require the entire binding graph to survive,
 * including symbols whose names could be captured by the new declaration.
 */
export function renameSlangSymbol(documents: readonly SlangRenameDocument[], uri: string, position: Position, newName: string): WorkspaceEdit | null {
  const commonUri = documents.find(document => document.uri === uri)?.environment.commonFile?.uri ?? uri;
  const activeSource = documents.find(document => document.uri === uri)?.text ?? '';
  documents = documents.filter(document => document.uri === uri || document.uri === commonUri || document.environment.commonFile?.uri === commonUri
    || activeSource.includes(document.uri.split('/').pop() ?? ''));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || reservedName(newName, documents)) {
    return null;
  }
  const sources = collectSources(documents);
  const source = sources.get(uri);
  if (source === undefined) {
    return null;
  }
  const offset = offsetAt(source, position);
  if (offset === undefined) {
    return null;
  }
  const cursor = !/[A-Za-z0-9_]/.test(source[offset] ?? '') && /[A-Za-z0-9_]/.test(source[offset - 1] ?? '') ? offset - 1 : offset;
  const selectedWord = wordAt(source, cursor);
  // Syntax outside the compatibility parser is resolved by SlangLanguageService
  // through the native declaration API. This pure fallback never guesses.
  const before = analyze(documents, sources);
  if (!before) {
    return null;
  }
  const target = [...before.bindings.values()].find(binding => [binding.declaration, ...binding.references.values()]
    .some(point => point.uri === uri && cursor >= point.offset && cursor < point.offset + binding.name.length));
  if (!target) {
    return null;
  }
  if (reservedName(target.name, documents) || target.name === newName) {
    return null;
  }
  if (target.kind !== 'field' && [target.declaration, ...target.references.values()]
    .some(point => before.visibleNames.get(key(point))?.has(newName))) {
    return null;
  }
  // A token with the target spelling that the AST cannot bind might be an
  // unresolved overload or member. Decline instead of returning a partial edit.
  const bound = new Set([...before.bindings.values()].flatMap(binding => [key(binding.declaration), ...binding.references.keys()]));
  for (const [id, point] of before.occurrences) {
    if (point.name === target.name && !bound.has(id) && !(point.member && target.kind !== 'field')) {
      return null;
    }
  }
  const edits = new Map<string, Edit[]>();
  for (const point of [target.declaration, ...target.references.values()]) {
    const current = edits.get(point.uri) ?? [];
    if (!current.some(edit => edit.start === point.offset)) {
      current.push({ start: point.offset, end: point.offset + target.name.length, newText: newName });
    }
    edits.set(point.uri, current);
  }
  const changed = new Map(sources);
  for (const [file, items] of edits) {
    const text = sources.get(file)!;
    changed.set(file, [...items].sort((a, b) => b.start - a.start).reduce((value, edit) => value.slice(0, edit.start) + newName + value.slice(edit.end), text));
  }
  const after = analyze(documents, changed);
  if (!after || before.bindings.size !== after.bindings.size) {
    return null;
  }
  const shifted = (point: Point): Point => ({ uri: point.uri, offset: point.offset + (edits.get(point.uri) ?? [])
    .filter(edit => edit.end <= point.offset).reduce((sum, edit) => sum + edit.newText.length - (edit.end - edit.start), 0) });
  for (const binding of before.bindings.values()) {
    const next = after.bindings.get(key(shifted(binding.declaration)));
    if (!next || next.kind !== binding.kind || next.name !== (binding === target ? newName : binding.name)) {
      return null;
    }
    const expected = [...binding.references.values()].map(point => key(shifted(point))).sort();
    if (JSON.stringify([...next.references.keys()].sort()) !== JSON.stringify(expected)) {
      return null;
    }
  }
  const changes: NonNullable<WorkspaceEdit['changes']> = {};
  for (const [file, items] of edits) {
    changes[file] = items.sort((a, b) => a.start - b.start).map(edit => ({
      range: { start: positionAt(sources.get(file)!, edit.start), end: positionAt(sources.get(file)!, edit.end) }, newText: newName,
    }));
  }
  return { changes };
}

/** Generic declarations are outside the GLSL compatibility grammar. Their
 * declaration and explicit-specialization call syntax are unambiguous, so
 * retain support without widening ordinary unresolved-name edits. */
function renameGenericFallback(documents: readonly SlangRenameDocument[], sources: ReadonlyMap<string, string>, uri: string, cursor: number, newName: string): WorkspaceEdit | null {
  const source = sources.get(uri);
  if (!source) {
    return null;
  }
  const word = wordAt(source, cursor);
  if (!word) {
    return null;
  }
  const declaration = new RegExp(`\\bgeneric\\s*<[^>{}()\\n]*>[^{};]*?\\b${word}\\s*\\(`);
  const owner = [...sources.entries()].find(([, text]) => declaration.test(text));
  if (!owner || (owner[0] !== uri && !documents.some(document => document.uri === owner[0]))) {
    return null;
  }
  const changes: Record<string, TextEdit[]> = {};
  for (const [file, text] of sources) {
    const edits: TextEdit[] = [];
    const matcher = new RegExp(`\\b${word}\\b(?=\\s*(?:<[^>{}()\\n]*>)?\\s*\\()`, 'g');
    for (const match of text.matchAll(matcher)) {
      const start = match.index!;
      // Require call/declaration form, so fields and same-spelled locals stay out.
      edits.push({ range: { start: positionAt(text, start), end: positionAt(text, start + word.length) }, newText: newName });
    }
    if (edits.length) {
      changes[file] = edits;
    }
  }
  return Object.keys(changes).length ? { changes } : null;
}

function renameMethodFallback(sources: ReadonlyMap<string, string>, uri: string, cursor: number, newName: string): WorkspaceEdit | null {
  const word = wordAt(sources.get(uri) ?? '', cursor);
  if (!word) {
    return null;
  }
  const declarations = [...sources.values()].flatMap(text => [...text.matchAll(new RegExp(`\\bstruct\\s+\\w+\\s*\\{[\\s\\S]*?\\b${word}\\s*\\(`, 'g'))]);
  if (declarations.length !== 1) {
    return null;
  }
  const changes: Record<string, TextEdit[]> = {};
  for (const [file, text] of sources) {
    const edits: TextEdit[] = [];
    // Declaration or member dispatch only. Free functions with the same name
    // are excluded; recursion remains a free-form call and is conservatively
    // left alone because Slang permits overloads in the containing type.
    // JavaScript has no portable \K, so inspect identifier tokens instead.
    for (const match of text.matchAll(new RegExp(`\\b${word}\\b(?=\\s*\\()`, 'g'))) {
      const start = match.index!;
      const before = text.slice(Math.max(0, start - 80), start);
      if (/\.\s*$/.test(before) || /\bstruct\s+\w+\s*\{[^{}]*$/.test(before)) {
        edits.push({ range: { start: positionAt(text, start), end: positionAt(text, start + word.length) }, newText: newName });
      }
    }
    if (edits.length) {
      changes[file] = edits;
    }
  }
  return Object.keys(changes).length ? { changes } : null;
}

function renameImportedFunctionFallback(sources: ReadonlyMap<string, string>, uri: string, cursor: number, newName: string): WorkspaceEdit | null {
  const source = sources.get(uri);
  const word = source ? wordAt(source, cursor) : undefined;
  if (!source || !word || !/\bimport\s+(?:"[^"]+"|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/.test(source)) {
    return null;
  }
  const owner = [...sources.entries()].find(([, text]) => new RegExp(`\\b(?:float|int|uint|bool|void|float[234])\\s+${word}\\s*\\(`).test(text));
  if (!owner || owner[0] === uri) {
    return null;
  }
  if ([...sources.values()].flatMap(text => [...text.matchAll(new RegExp(`\\b(?:float|int|uint|bool|void|float[234])\\s+${word}\\s*\\(`, 'g'))]).length !== 1) {
    return null;
  }
  const changes: Record<string, TextEdit[]> = {};
  for (const [file, text] of sources) {
    const edits = [...text.matchAll(new RegExp(`\\b${word}\\b(?=\\s*\\()`, 'g'))].map(match => ({
      range: { start: positionAt(text, match.index!), end: positionAt(text, match.index! + word.length) }, newText: newName,
    }));
    if (edits.length) {
      changes[file] = edits;
    }
  }
  return Object.keys(changes).length ? { changes } : null;
}

function collectSources(documents: readonly SlangRenameDocument[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const document of documents) {
    if (document.environment.commonFile) {
      sources.set(document.environment.commonFile.uri, document.environment.commonFile.text);
    }
  }
  // Open editor text takes precedence over an environment's older snapshot.
  for (const document of documents) {
    sources.set(document.uri, document.text);
  }
  return sources;
}

function analyze(documents: readonly SlangRenameDocument[], sources: ReadonlyMap<string, string>): Analysis | undefined {
  const bindings = new Map<string, Binding>();
  const occurrences = new Map<string, Occurrence>();
  const visibleNames = new Map<string, Set<string>>();
  for (const document of documents) {
    const commonUri = document.environment.commonFile?.uri;
    const files = commonUri && commonUri !== document.uri ? [commonUri, document.uri] : [document.uri];
    let combined = '';
    const origins: (Point | undefined)[] = [];
    for (const uri of files) {
      const text = sources.get(uri)!;
      const converted = normalize(text, uri);
      if (!converted) {
        return undefined;
      }
      combined += converted.text + '\n';
      for (const point of converted.origins) {
        origins.push(point);
      }
      origins.push(undefined);
      for (const point of converted.identifiers) {
        occurrences.set(key(point), point);
      }
    }
    const parsed = parseGlslDocument(document.uri, combined, document.environment.stage);
    if (!parsed.parsedSuccessfully || parsed.diagnostics.length) {
      return undefined;
    }
    const origin = (range: Range) => {
      const offset = offsetAt(combined, range.start);
      return offset === undefined ? undefined : origins[offset];
    };
    for (const symbol of parsed.symbols) {
      const declaration = origin(symbol.declaration);
      if (!declaration) {
        return undefined;
      }
      const authored = sources.get(declaration.uri)!;
      // A normalized built-in type is not an authored declaration name.
      if (authored.slice(declaration.offset, declaration.offset + symbol.name.length) !== symbol.name) {
        return undefined;
      }
      const id = key(declaration);
      const binding = bindings.get(id) ?? { name: symbol.name, kind: symbol.kind, declaration, references: new Map<string, Point>() };
      if (binding.name !== symbol.name || binding.kind !== symbol.kind) {
        return undefined;
      }
      for (const range of [symbol.declaration, ...symbol.references]) {
        const point = origin(range);
        if (!point) {
          return undefined;
        }
        const names = visibleNames.get(key(point)) ?? new Set<string>();
        for (const visible of visibleSymbolsAtPosition(parsed, range.start)) {
          names.add(visible.name);
        }
        visibleNames.set(key(point), names);
      }
      for (const range of symbol.references) {
        const point = origin(range);
        if (!point || sources.get(point.uri)?.slice(point.offset, point.offset + symbol.name.length) !== symbol.name) {
          return undefined;
        }
        if (key(point) !== id) {
          binding.references.set(key(point), point);
        }
      }
      bindings.set(id, binding);
    }
    // The GLSL resolver accepts generic function declarations after the header
    // is blanked, but cannot infer calls through a type parameter. Bind only a
    // unique generic declaration and only call-shaped uses of that name.
    for (const generic of genericFunctions(files.map(uri => ({ uri, text: sources.get(uri)! })))) {
      const declaration = generic.declaration;
      const binding = bindings.get(key(declaration));
      if (!binding || binding.kind !== "function") {
        continue;
      }
      for (const file of files) {
        const text = sources.get(file)!;
        for (const match of text.matchAll(new RegExp(`\\b${generic.name}\\b(?=\\s*(?:<[^>{}()\\n]*>)?\\s*\\()`, "g"))) {
          const point = { uri: file, offset: match.index! };
          if (key(point) !== key(declaration)) {
            binding.references.set(key(point), point);
          }
        }
      }
    }
  }
  return { bindings, occurrences, visibleNames };
}

function genericFunctions(files: readonly { uri: string; text: string }[]): { name: string; declaration: Point }[] {
  const found: { name: string; declaration: Point }[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(/\b(?:__)?generic\s*<[^>{}()\n]*>\s*[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\(/g)) {
      const name = match[1]!;
      const offset = match.index! + match[0].lastIndexOf(name);
      found.push({ name, declaration: { uri: file.uri, offset } });
    }
  }
  return found.filter(item => found.filter(candidate => candidate.name === item.name).length === 1);
}

/** Preserve a character-level source map when type spellings change length. */
function normalize(source: string, uri: string) {
  const origins: Point[] = [];
  const identifiers: Occurrence[] = [];
  let previousCodeToken = '';
  let text = '';
  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z0-9_]*|[^]/g;
  // The host import is implicit; it introduces no user-owned symbols.
  const blank = (text: string) => text.replace(/[^\r\n]/g, ' ');
  const input = source
    .replace(/^[ \t]*import[ \t]+(?:shader_studio|"shader-studio\.slang")[ \t]*;?[ \t]*$/gm, blank)
    // These attributes and system semantics contain no user symbol references.
    // Other attributes (including nonliteral numthreads arguments) stay intact
    // and are rejected by the parser rather than losing a reference.
    .replace(/\[\s*shader\s*\(\s*"(?:compute|vertex|fragment)"\s*\)\s*\]/g, blank)
    .replace(/\[\s*numthreads\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)\s*\]/g, blank)
    .replace(/:\s*SV_[A-Za-z0-9_]+\b/g, blank)
    // Lower generic syntax to an ordinary declaration/call shape. The generic
    // parameter list and explicit specialization are not authored references;
    // blanks retain every subsequent authored offset. Both spellings lower:
    // `generic` is what authors write, `__generic` is what the bundled
    // compiler accepts.
    .replace(/\b(?:__)?generic\s*<[^>{}()\n]*>/g, blank)
    .replace(/\b([A-Za-z_]\w*)\s*<\s*(?:float|int|uint|bool|float[234]|int[234]|uint[234]|bool[234])\s*>/g,
      (_match, name: string) => name + ' '.repeat(_match.length - name.length));
  // Inside `import ... ;`: the statement introduces module names, not authored
  // bindings, so the whole tail is blanked. Imported names keep no occurrence
  // and any rename touching them is declined; locals stay renamable.
  let importTail = false;
  for (const match of input.matchAll(tokens)) {
    const token = match[0];
    const start = match.index!;
    const comment = token.startsWith('//') || token.startsWith('/*');
    if (token.startsWith('/*') && !token.endsWith('*/')) {
      return undefined;
    }
    if (!comment && token === 'import') {
      importTail = true;
    }
    if (!comment && (token === '#' || token.startsWith('"') || token.startsWith("'")
      || /^(?:module|implementing|namespace|interface|extension|typealias|typedef|__include|__exported|class|enum)$/.test(token))) {
      return undefined;
    }
    let replacement = comment || token === 'static' ? token.replace(/[^\r\n]/g, ' ') : numericType(token);
    if (importTail) {
      replacement = token.replace(/[^\r\n]/g, ' ');
      if (token === ';' || token.includes('\n')) {
        importTail = false;
      }
    } else {
      if (!comment && /^[A-Za-z_]/.test(token)) {
        identifiers.push({ uri, offset: start, name: token, member: previousCodeToken === '.' });
      }
      if (!comment && token.trim()) {
        previousCodeToken = token;
      }
    }
    // A lone '<' or '>' may be a comparison. Generic types/attributes are
    // rejected by the strict parser, never stripped into a different program.
    if (replacement === undefined) {
      replacement = token;
    }
    text += replacement;
    for (let index = 0; index < replacement.length; index++) {
      origins.push({ uri, offset: start + Math.min(index, token.length - 1) });
    }
  }
  return { text, origins, identifiers };
}

function numericType(name: string): string | undefined {
  const vector = /^(float|int|uint|bool)([234])$/.exec(name);
  if (vector) {
    return `${{ float: 'vec', int: 'ivec', uint: 'uvec', bool: 'bvec' }[vector[1]]}${vector[2]}`;
  }
  const matrix = /^float([234])x([234])$/.exec(name);
  return matrix ? `mat${matrix[2]}x${matrix[1]}` : undefined;
}
function reservedName(name: string, documents: readonly SlangRenameDocument[]): boolean {
  return /^(?:new|operator|mainImage|mainVertex|mainCompute|inputs|float|int|uint|bool|void)$/.test(name)
    || numericType(name) !== undefined || name.startsWith('__') || name.startsWith('_ss')
    || SHADER_STUDIO_SYMBOL_DOCS.some(symbol => symbol.languages.includes('slang') && symbol.name === name)
    || documents.some(document => document.environment.customUniforms.some(uniform => uniform.name === name)
      || document.environment.resources.some(resource => resource.name === name));
}
function key(point: Point): string {
  return `${point.uri}\0${point.offset}`;
}
function offsetAt(source: string, position: Position): number | undefined {
  const lines = source.split('\n');
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0 || position.line >= lines.length || position.character > lines[position.line].length) {
    return undefined;
  }
  return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
}
function positionAt(source: string, offset: number): Position {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}
function wordAt(source: string, offset: number): string | undefined {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1])) {
    start--;
  }
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(start));
  return match?.[0];
}
