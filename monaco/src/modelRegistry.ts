import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

interface ModelReference {
  model: Monaco.editor.ITextModel;
  references: number;
  owned: boolean;
  disposalGeneration: number;
}

const registries = new WeakMap<typeof Monaco, Map<string, ModelReference>>();

function registry(monaco: typeof Monaco): Map<string, ModelReference> {
  let value = registries.get(monaco);
  if (!value) {
    value = new Map();
    registries.set(monaco, value);
  }
  return value;
}

export function canonicalEditorUri(monaco: typeof Monaco, pathOrUri: string): Monaco.Uri {
  const parsed = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(pathOrUri)
    ? new URL(pathOrUri)
    : new URL(monaco.Uri.file(pathOrUri).toString());
  if (parsed.protocol !== 'file:') {
    return monaco.Uri.parse(parsed.href);
  }
  const host = parsed.hostname.toLowerCase() === 'localhost' ? '' : parsed.hostname.toLowerCase();
  const parts: string[] = [];
  for (const part of decodeURIComponent(parsed.pathname).replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const path = `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
  return monaco.Uri.parse(`file://${host}${path}`);
}

export function acquireEditorModel(
  monaco: typeof Monaco,
  pathOrUri: string,
  source: string,
  language: 'glsl' | 'slang',
): Monaco.editor.ITextModel {
  return acquireEditorModelReference(monaco, pathOrUri, source, language).model;
}

export interface EditorModelReference {
  model: Monaco.editor.ITextModel;
  hadOwners: boolean;
}

export function acquireEditorModelReference(
  monaco: typeof Monaco,
  pathOrUri: string,
  source: string,
  language: 'glsl' | 'slang',
): EditorModelReference {
  const uri = canonicalEditorUri(monaco, pathOrUri);
  const key = uri.toString();
  const entries = registry(monaco);
  const tracked = entries.get(key);
  if (tracked && !tracked.model.isDisposed()) {
    const hadOwners = tracked.references > 0;
    tracked.references += 1;
    tracked.disposalGeneration += 1;
    if (tracked.model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(tracked.model, language);
    }
    return { model: tracked.model, hadOwners };
  }
  const existing = monaco.editor.getModel(uri);
  const model = existing ?? monaco.editor.createModel(source, language, uri);
  entries.set(key, { model, references: 1, owned: !existing, disposalGeneration: 0 });
  return { model, hadOwners: existing !== null };
}

export function releaseEditorModel(monaco: typeof Monaco, model: Monaco.editor.ITextModel): void {
  const entries = registry(monaco);
  const key = model.uri.toString();
  const tracked = entries.get(key);
  if (!tracked || tracked.model !== model) {
    return;
  }
  tracked.references = Math.max(0, tracked.references - 1);
  const generation = ++tracked.disposalGeneration;
  queueMicrotask(() => {
    const current = entries.get(key);
    if (!current || current !== tracked || current.references !== 0 || current.disposalGeneration !== generation) {
      return;
    }
    entries.delete(key);
    if (current.owned && !current.model.isDisposed()) {
      current.model.dispose();
    }
  });
}
