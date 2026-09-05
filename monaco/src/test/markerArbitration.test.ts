import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RENDERER_COMPILER_MARKER_OWNER,
  markerOwner,
  resetMarkerArbitration,
  setCompilerMarkers,
  setLanguageServiceMarkers,
  suppressDuplicateMarkers,
} from "../language-services/markerArbitration";

const ERROR = 8;
const WARNING = 4;

function marker(line: number, message: string, severity = ERROR, column = 1) {
  return {
    severity,
    message,
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column + 4,
  };
}

function fixture(languageId: "glsl" | "slang") {
  const setModelMarkers = vi.fn();
  const monaco = { editor: { setModelMarkers } } as never as typeof import("monaco-editor/esm/vs/editor/editor.api.js");
  const model = { getLanguageId: () => languageId } as never as import("monaco-editor/esm/vs/editor/editor.api.js").editor.ITextModel;
  const published = (owner: string) => {
    const calls = setModelMarkers.mock.calls.filter((call) => call[1] === owner);
    return calls.at(-1)?.[2] as ReturnType<typeof marker>[] | undefined;
  };
  return { monaco, model, setModelMarkers, published };
}

describe("marker arbitration", () => {
  let slang: ReturnType<typeof fixture>;
  let glsl: ReturnType<typeof fixture>;

  beforeEach(() => {
    slang = fixture("slang");
    glsl = fixture("glsl");
    resetMarkerArbitration(slang.model);
    resetMarkerArbitration(glsl.model);
  });

  it("drops the renderer marker a Slang language service already reported", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier 'stepp'", ERROR, 15)]);
    setCompilerMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier 'stepp'")]);

    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toEqual([]);
    expect(slang.published(markerOwner("slang"))).toHaveLength(1);
  });

  it("drops the Slang renderer marker even when the compiler published first", () => {
    setCompilerMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier")]);
    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);

    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier 'stepp'", ERROR, 15)]);

    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toEqual([]);
  });

  it("drops the GLSL language service marker the driver already reported", () => {
    setCompilerMarkers(glsl.monaco, glsl.model, [marker(5, "'x' : undeclared identifier")]);
    setLanguageServiceMarkers(glsl.monaco, glsl.model, [marker(5, "Undefined identifier 'x'.")]);

    expect(glsl.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);
    expect(glsl.published(markerOwner("glsl"))).toEqual([]);
  });

  it("keeps renderer markers the language service never sees", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier")]);
    setCompilerMarkers(slang.monaco, slang.model, [
      marker(14, "undefined identifier"),
      marker(30, "link failed: iChannel0 unbound"),
    ]);

    const kept = slang.published(RENDERER_COMPILER_MARKER_OWNER);
    expect(kept).toHaveLength(1);
    expect(kept?.[0].message).toContain("link failed");
  });

  it("keeps markers on different lines", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier")]);
    setCompilerMarkers(slang.monaco, slang.model, [marker(20, "syntax error")]);

    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);
  });

  it("restores a suppressed marker once the winning side clears", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier")]);
    setCompilerMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier")]);
    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toEqual([]);

    setLanguageServiceMarkers(slang.monaco, slang.model, []);

    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);
  });

  it("never lets a warning suppress an error", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(3, "unused uniform", WARNING)]);
    setCompilerMarkers(slang.monaco, slang.model, [marker(3, "undefined identifier")]);

    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);
  });

  it("keeps a loser's warning on a line the winner reported an error on", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(3, "undefined identifier")]);
    setCompilerMarkers(slang.monaco, slang.model, [marker(3, "slow path", WARNING)]);

    expect(slang.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);
  });

  it("tracks each model separately", () => {
    setLanguageServiceMarkers(slang.monaco, slang.model, [marker(14, "undefined identifier")]);
    setCompilerMarkers(glsl.monaco, glsl.model, [marker(14, "'x' : undeclared identifier")]);

    expect(glsl.published(RENDERER_COMPILER_MARKER_OWNER)).toHaveLength(1);
  });

  describe("suppressDuplicateMarkers", () => {
    it("returns the loser untouched when the winner reported no errors", () => {
      const loser = [marker(1, "kept")];

      expect(suppressDuplicateMarkers([marker(1, "hint", WARNING)], loser)).toEqual(loser);
      expect(suppressDuplicateMarkers([], loser)).toEqual(loser);
    });

    it("suppresses by start line, not by exact column", () => {
      expect(suppressDuplicateMarkers([marker(9, "winner", ERROR, 2)], [marker(9, "loser", ERROR, 40)])).toEqual([]);
    });
  });
});
