import { afterEach, describe, expect, it } from "vitest";
import {
  clearCurrentEditorSource,
  getCurrentEditorSource,
  setCurrentEditorSource,
} from "../../lib/state/currentEditorSourceState.svelte";

describe("current editor source state", () => {
  afterEach(() => clearCurrentEditorSource());

  it("only returns an editor source to its owning root shader", () => {
    setCurrentEditorSource("/projects/a/image.wgsl", "/projects/a/buffer.wgsl");

    expect(getCurrentEditorSource("/projects/a/image.wgsl")).toBe("/projects/a/buffer.wgsl");
    expect(getCurrentEditorSource("/projects/b/image.wgsl")).toBe("");
  });

  it("does not let an old project clear the current project's editor target", () => {
    setCurrentEditorSource("/projects/b/image.wgsl", "/projects/b/buffer.wgsl");
    clearCurrentEditorSource("/projects/a/image.wgsl");

    expect(getCurrentEditorSource("/projects/b/image.wgsl")).toBe("/projects/b/buffer.wgsl");
  });
});
