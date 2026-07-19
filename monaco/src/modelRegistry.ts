import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

interface ModelReference {
  model: Monaco.editor.ITextModel;
  owners: Map<object, { kind: EditorModelOwnerKind; references: number }>;
  owned: boolean;
  disposalGeneration: number;
}

export type EditorModelOwnerKind = 'editor' | 'adapter' | 'external';

export interface EditorModelOwner {
  kind: EditorModelOwnerKind;
  token: object;
}

export interface EditorModelOwnerQuery {
  kind?: EditorModelOwnerKind;
  token?: object;
  excludingKind?: EditorModelOwnerKind;
  excludingToken?: object;
}

const defaultEditorOwner = createEditorModelOwner('editor');
const inferredExternalOwner = createEditorModelOwner('external');

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

export function createEditorModelOwner(kind: EditorModelOwnerKind): EditorModelOwner {
  return { kind, token: {} };
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
  owner: EditorModelOwner = defaultEditorOwner,
): EditorModelReference {
  const uri = canonicalEditorUri(monaco, pathOrUri);
  const key = uri.toString();
  const entries = registry(monaco);
  const tracked = entries.get(key);
  if (tracked && !tracked.model.isDisposed()) {
    const hadOwners = referenceCount(tracked) > 0;
    addOwnerReference(tracked, owner);
    tracked.disposalGeneration += 1;
    if (tracked.model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(tracked.model, language);
    }
    return { model: tracked.model, hadOwners };
  }
  const existing = monaco.editor.getModel(uri);
  const model = existing ?? monaco.editor.createModel(source, language, uri);
  const reference: ModelReference = {
    model,
    owners: new Map(),
    owned: !existing,
    disposalGeneration: 0,
  };
  if (existing) {
    addOwnerReference(reference, inferredExternalOwner);
  }
  addOwnerReference(reference, owner);
  entries.set(key, reference);
  return { model, hadOwners: existing !== null };
}

export function getEditorModelOwnerReferenceCount(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  query: EditorModelOwnerQuery = {},
): number {
  const tracked = registry(monaco).get(model.uri.toString());
  if (!tracked || tracked.model !== model) {
    return 0;
  }
  let references = 0;
  for (const [token, owner] of tracked.owners) {
    if (query.kind && owner.kind !== query.kind) {
      continue;
    }
    if (query.token && token !== query.token) {
      continue;
    }
    if (query.excludingKind && owner.kind === query.excludingKind) {
      continue;
    }
    if (query.excludingToken && token === query.excludingToken) {
      continue;
    }
    references += owner.references;
  }
  return references;
}

export function releaseEditorModel(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  owner: EditorModelOwner = defaultEditorOwner,
): void {
  const entries = registry(monaco);
  const key = model.uri.toString();
  const tracked = entries.get(key);
  if (!tracked || tracked.model !== model) {
    return;
  }
  const ownerReference = tracked.owners.get(owner.token);
  if (!ownerReference || ownerReference.kind !== owner.kind) {
    return;
  }
  ownerReference.references -= 1;
  if (ownerReference.references === 0) {
    tracked.owners.delete(owner.token);
  }
  const generation = ++tracked.disposalGeneration;
  queueMicrotask(() => {
    const current = entries.get(key);
    if (!current || current !== tracked || referenceCount(current) !== 0 || current.disposalGeneration !== generation) {
      return;
    }
    entries.delete(key);
    if (current.owned && !current.model.isDisposed()) {
      current.model.dispose();
    }
  });
}

function addOwnerReference(reference: ModelReference, owner: EditorModelOwner): void {
  const trackedOwner = reference.owners.get(owner.token);
  if (trackedOwner) {
    if (trackedOwner.kind !== owner.kind) {
      throw new Error('A Monaco model owner token cannot be reused with a different owner kind');
    }
    trackedOwner.references += 1;
    return;
  }
  reference.owners.set(owner.token, { kind: owner.kind, references: 1 });
}

function referenceCount(reference: ModelReference): number {
  let total = 0;
  for (const owner of reference.owners.values()) {
    total += owner.references;
  }
  return total;
}
