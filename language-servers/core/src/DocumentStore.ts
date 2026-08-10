import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { ShaderDocumentSnapshot } from "./protocol";

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

    this.environments.set(environment.documentUri, Object.freeze({ ...environment }));
    return true;
  }

  getDocument(uri: string): Readonly<ShaderDocumentSnapshot> | undefined {
    return this.documents.get(uri);
  }

  getEnvironment(uri: string): Readonly<ShaderAuthoringEnvironment> | undefined {
    return this.environments.get(uri);
  }

  isCurrent(uri: string, version: number, generation: number): boolean {
    return this.documents.get(uri)?.version === version && this.environments.get(uri)?.generation === generation;
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
