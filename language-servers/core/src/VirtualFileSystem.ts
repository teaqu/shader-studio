import type { ShaderDocumentSnapshot } from "./protocol";
import type { VirtualShaderFile } from "@shader-studio/types";

export interface VirtualFileSnapshot {
  readonly uri: string;
  readonly text: string;
  readonly version: number;
}

/** Browser-safe overlay filesystem used by both language services. */
export class VirtualFileSystem {
  private readonly environmentFiles = new Map<string, Readonly<VirtualFileSnapshot>>();
  private readonly overlays = new Map<string, Readonly<VirtualFileSnapshot>>();
  private readonly dependencies = new Map<string, Set<string>>();

  replaceEnvironment(files: readonly Readonly<VirtualShaderFile>[]): void {
    this.environmentFiles.clear();
    for (const file of files) {
      const uri = canonicalizeShaderUri(file.uri);
      this.environmentFiles.set(uri, Object.freeze({ uri, text: file.text, version: file.version }));
    }
  }

  openOverlay(document: Pick<ShaderDocumentSnapshot, "uri" | "text" | "version">): void {
    const uri = canonicalizeShaderUri(document.uri);
    this.overlays.set(uri, Object.freeze({ uri, text: document.text, version: document.version }));
  }

  closeOverlay(uri: string): void {
    this.overlays.delete(canonicalizeShaderUri(uri));
  }

  read(uri: string): Readonly<VirtualFileSnapshot> | undefined {
    const canonical = canonicalizeShaderUri(uri);
    return this.overlays.get(canonical) ?? this.environmentFiles.get(canonical);
  }

  resolve(ownerUri: string, reference: string): string | undefined {
    if (!reference || reference.includes("\\")) {
      return undefined;
    }
    try {
      const owner = new URL(canonicalizeShaderUri(ownerUri));
      const resolved = new URL(reference, owner);
      if (resolved.protocol !== owner.protocol || resolved.origin !== owner.origin) {
        return undefined;
      }
      const root = workspaceRoot(owner.pathname);
      const canonical = canonicalizeShaderUri(resolved.toString());
      return new URL(canonical).pathname.startsWith(root) ? canonical : undefined;
    } catch {
      return undefined;
    }
  }

  trackDependency(ownerUri: string, dependencyUri: string): void {
    const dependency = canonicalizeShaderUri(dependencyUri);
    const owner = canonicalizeShaderUri(ownerUri);
    const dependents = this.dependencies.get(dependency) ?? new Set<string>();
    dependents.add(owner);
    this.dependencies.set(dependency, dependents);
  }

  clearDependencies(ownerUri: string): void {
    const owner = canonicalizeShaderUri(ownerUri);
    for (const dependents of this.dependencies.values()) {
      dependents.delete(owner);
    }
  }

  dependentsOf(uri: string): readonly string[] {
    return [...(this.dependencies.get(canonicalizeShaderUri(uri)) ?? [])].sort();
  }
}

export function canonicalizeShaderUri(uri: string): string {
  const parsed = new URL(uri);
  const segments: string[] = [];
  for (const segment of parsed.pathname.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  parsed.pathname = `/${segments.join("/")}`;
  parsed.hash = "";
  return parsed.toString();
}

function workspaceRoot(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 1 ? `/${segments[0]}/` : "/";
}
