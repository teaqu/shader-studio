import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { DocumentRevision, ShaderDocumentSnapshot } from "./protocol";

export class DocumentStore {
  private readonly documents = new Map<string, Readonly<ShaderDocumentSnapshot>>();
  private readonly environments = new Map<string, Readonly<ShaderAuthoringEnvironment>>();

  open(document: ShaderDocumentSnapshot): boolean {
    return this.updateDocument(document);
  }

  change(document: ShaderDocumentSnapshot): boolean {
    return this.updateDocument(document);
  }

  close(uri: string): void {
    this.documents.delete(uri);
    this.environments.delete(uri);
  }

  syncEnvironment(environment: ShaderAuthoringEnvironment): boolean {
    const current = this.environments.get(environment.documentUri);
    if (current && environment.generation <= current.generation) {
      return false;
    }

    this.environments.set(environment.documentUri, freezeEnvironment(environment));
    return true;
  }

  getDocument(uri: string): Readonly<ShaderDocumentSnapshot> | undefined {
    return this.documents.get(uri);
  }

  getEnvironment(uri: string): Readonly<ShaderAuthoringEnvironment> | undefined {
    return this.environments.get(uri);
  }

  isCurrent(revision: DocumentRevision): boolean {
    const document = this.documents.get(revision.uri);
    const environment = this.environments.get(revision.uri);
    return document?.languageId === revision.languageId
      && document.version === revision.version
      && environment?.languageId === revision.languageId
      && environment.generation === revision.environmentGeneration;
  }

  private updateDocument(document: ShaderDocumentSnapshot): boolean {
    const current = this.documents.get(document.uri);
    if (current && document.version <= current.version) {
      return false;
    }

    this.documents.set(document.uri, Object.freeze({ ...document }));
    return true;
  }
}

function freezeEnvironment(environment: ShaderAuthoringEnvironment): Readonly<ShaderAuthoringEnvironment> {
  return Object.freeze({
    ...environment,
    customUniforms: Object.freeze(environment.customUniforms.map((uniform) => Object.freeze({ ...uniform }))),
    resources: Object.freeze(environment.resources.map((resource) => Object.freeze({ ...resource }))),
    virtualFiles: Object.freeze(environment.virtualFiles.map((file) => Object.freeze({ ...file }))),
  });
}
