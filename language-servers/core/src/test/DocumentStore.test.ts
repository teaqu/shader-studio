import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { describe, expect, it } from "vitest";
import { DocumentStore } from "../DocumentStore";
import type {
  AnalysisWorkerResponse,
  DiagnosticsWorkerNotification,
  DocumentRevision,
} from "../protocol";

const URI = "file:///image.glsl";

function environment(generation: number): ShaderAuthoringEnvironment {
  return {
    documentUri: URI,
    languageId: "glsl",
    generation,
    passName: "Image",
    stage: "fragment",
    customUniforms: [],
    resources: [],
    virtualFiles: [],
  };
}

function seededStore(): DocumentStore {
  const store = new DocumentStore();
  store.open({ uri: URI, languageId: "glsl", version: 2, text: "initial" });
  store.syncEnvironment(environment(4));
  return store;
}

function revision(version: number, environmentGeneration: number): DocumentRevision {
  return {
    uri: URI,
    languageId: "glsl",
    version,
    environmentGeneration,
  };
}

describe("DocumentStore", () => {
  it("rejects stale, equal, and accepts newer document versions", () => {
    const store = new DocumentStore();

    expect(store.open({ uri: URI, languageId: "glsl", version: 2, text: "current" })).toBe(true);
    expect(store.change({ uri: URI, languageId: "glsl", version: 1, text: "stale" })).toBe(false);
    expect(store.change({ uri: URI, languageId: "glsl", version: 2, text: "equal" })).toBe(false);
    expect(store.change({ uri: URI, languageId: "glsl", version: 3, text: "newer" })).toBe(true);

    expect(store.getDocument(URI)?.text).toBe("newer");
  });

  it("rejects stale, equal, and accepts newer environment generations", () => {
    const store = new DocumentStore();

    expect(store.syncEnvironment(environment(4))).toBe(true);
    expect(store.syncEnvironment(environment(3))).toBe(false);
    expect(store.syncEnvironment(environment(4))).toBe(false);
    expect(store.syncEnvironment(environment(5))).toBe(true);

    expect(store.getEnvironment(URI)?.generation).toBe(5);
  });

  it("clones and freezes accepted snapshots", () => {
    const store = new DocumentStore();
    const document = { uri: URI, languageId: "glsl" as const, version: 2, text: "initial" };
    const authoringEnvironment = environment(4);

    store.open(document);
    store.syncEnvironment(authoringEnvironment);
    document.text = "source changed";
    authoringEnvironment.generation = 9;

    const storedDocument = store.getDocument(URI);
    const storedEnvironment = store.getEnvironment(URI);

    expect(storedDocument).toEqual({ uri: URI, languageId: "glsl", version: 2, text: "initial" });
    expect(storedEnvironment).toEqual(environment(4));
    expect(Object.isFrozen(storedDocument)).toBe(true);
    expect(Object.isFrozen(storedEnvironment)).toBe(true);
    expect(Reflect.set(storedDocument!, "text", "stored changed")).toBe(false);
    expect(Reflect.set(storedEnvironment!, "generation", 10)).toBe(false);
  });

  it("deeply clones and freezes nested authoring declarations", () => {
    const store = new DocumentStore();
    const authoringEnvironment = {
      ...environment(4),
      customUniforms: [{ name: "tint", type: "vec3" as const }],
      resources: [{ name: "sky", kind: "texture-cube" as const }],
      virtualFiles: [{ uri: "file:///common.glsl", text: "float helper() { return 0.; }", version: 2 }],
    };

    store.syncEnvironment(authoringEnvironment);
    authoringEnvironment.customUniforms[0]!.name = "changed";
    authoringEnvironment.resources.push({ name: "extra", kind: "texture-2d" });
    authoringEnvironment.virtualFiles[0]!.text = "changed";

    const stored = store.getEnvironment(URI)!;
    expect(stored.customUniforms).toEqual([{ name: "tint", type: "vec3" }]);
    expect(stored.resources).toEqual([{ name: "sky", kind: "texture-cube" }]);
    expect(stored.virtualFiles).toEqual([
      { uri: "file:///common.glsl", text: "float helper() { return 0.; }", version: 2 },
    ]);
    expect(Object.isFrozen(stored.customUniforms)).toBe(true);
    expect(Object.isFrozen(stored.customUniforms[0])).toBe(true);
    expect(Object.isFrozen(stored.resources)).toBe(true);
    expect(Object.isFrozen(stored.virtualFiles[0])).toBe(true);
    expect(Reflect.set(stored.customUniforms[0]!, "name", "stored changed")).toBe(false);
    expect(Reflect.set(stored.virtualFiles[0]!, "text", "stored changed")).toBe(false);
  });

  it("removes document and environment together", () => {
    const store = seededStore();

    store.close(URI);

    expect(store.getDocument(URI)).toBeUndefined();
    expect(store.getEnvironment(URI)).toBeUndefined();
  });

  it("is current only for the exact document and environment revision", () => {
    const store = seededStore();

    expect(new DocumentStore().isCurrent(revision(2, 4))).toBe(false);
    expect(store.isCurrent(revision(1, 4))).toBe(false);
    expect(store.isCurrent(revision(2, 3))).toBe(false);
    expect(store.isCurrent(revision(2, 4))).toBe(true);
  });

  it("rejects an in-flight response after only the environment generation changes", () => {
    const store = seededStore();
    const requestRevision = revision(2, 4);
    const response: AnalysisWorkerResponse = {
      kind: "response",
      id: 12,
      method: "diagnostics",
      revision: requestRevision,
      result: [],
    };

    expect(store.isCurrent(response.revision)).toBe(true);
    expect(store.syncEnvironment(environment(5))).toBe(true);
    expect(store.getDocument(URI)?.version).toBe(2);
    expect(store.isCurrent(response.revision)).toBe(false);
    expect(store.isCurrent(revision(2, 5))).toBe(true);
  });

  it("rejects stale diagnostics when the text version is unchanged", () => {
    const store = seededStore();
    const notification: DiagnosticsWorkerNotification = {
      kind: "notification",
      method: "diagnostics",
      revision: revision(2, 4),
      params: [],
    };

    expect(store.syncEnvironment(environment(5))).toBe(true);
    expect(store.getDocument(URI)?.version).toBe(notification.revision.version);
    expect(store.isCurrent(notification.revision)).toBe(false);
  });
});
