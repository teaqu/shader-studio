import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { describe, expect, it } from "vitest";
import { DocumentStore } from "../DocumentStore";

const URI = "file:///image.glsl";

function environment(generation: number): ShaderAuthoringEnvironment {
  return { documentUri: URI, languageId: "glsl", generation };
}

function seededStore(): DocumentStore {
  const store = new DocumentStore();
  store.open({ uri: URI, languageId: "glsl", version: 2, text: "initial" });
  store.syncEnvironment(environment(4));
  return store;
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

  it("removes document and environment together", () => {
    const store = seededStore();

    store.close(URI);

    expect(store.getDocument(URI)).toBeUndefined();
    expect(store.getEnvironment(URI)).toBeUndefined();
  });

  it("is current only for matching document and environment revisions", () => {
    const store = seededStore();

    expect(new DocumentStore().isCurrent(URI, 2, 4)).toBe(false);
    expect(store.isCurrent(URI, 1, 4)).toBe(false);
    expect(store.isCurrent(URI, 2, 3)).toBe(false);
    expect(store.isCurrent(URI, 2, 4)).toBe(true);
  });
});
