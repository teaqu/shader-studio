/**
 * The renderer compiler and the language service mark the same lines, so one
 * mistake used to draw two squiggles. Whichever report came from the real
 * compiler for that language survives:
 *
 * - Slang: the language service runs the Slang compiler itself and reports
 *   columns and error codes the renderer payload loses, so it wins.
 * - GLSL: renderer errors come from the driver while the GLSL service is a
 *   hand-written analyser, so the compiler wins.
 *
 * Only errors suppress errors, and only on the same line, so warnings and the
 * link/binding failures the language services never see always survive.
 */
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type { ShaderLanguage } from "@shader-studio/language-server-core";

export const RENDERER_COMPILER_MARKER_OWNER = "shader-studio-renderer-compiler";

export function markerOwner(language: ShaderLanguage): string {
  return `shader-studio-${language}-ls`;
}

const submitted = new WeakMap<Monaco.editor.ITextModel, SubmittedMarkers>();

interface SubmittedMarkers {
  compiler: Monaco.editor.IMarkerData[];
  languageService: Monaco.editor.IMarkerData[];
}

export function setCompilerMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  markers: readonly Monaco.editor.IMarkerData[],
): void {
  entryFor(model).compiler = [...markers];
  republish(monaco, model);
}

export function setLanguageServiceMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  markers: readonly Monaco.editor.IMarkerData[],
): void {
  entryFor(model).languageService = [...markers];
  republish(monaco, model);
}

/** Exposed for tests: forgets what a model had submitted. */
export function resetMarkerArbitration(model: Monaco.editor.ITextModel): void {
  submitted.delete(model);
}

function entryFor(model: Monaco.editor.ITextModel): SubmittedMarkers {
  const existing = submitted.get(model);
  if (existing) {
    return existing;
  }
  const created: SubmittedMarkers = { compiler: [], languageService: [] };
  submitted.set(model, created);
  return created;
}

function republish(monaco: typeof Monaco, model: Monaco.editor.ITextModel): void {
  const entry = entryFor(model);
  const language = model.getLanguageId() === "slang" ? "slang" : "glsl";
  const compilerWins = language === "glsl";
  const compiler = compilerWins
    ? entry.compiler
    : suppressDuplicateMarkers(entry.languageService, entry.compiler);
  const languageService = compilerWins
    ? suppressDuplicateMarkers(entry.compiler, entry.languageService)
    : entry.languageService;

  monaco.editor.setModelMarkers(model, RENDERER_COMPILER_MARKER_OWNER, compiler);
  monaco.editor.setModelMarkers(model, markerOwner(language), languageService);
}

/** Drops the loser's errors on lines the winner already reported an error on. */
export function suppressDuplicateMarkers(
  winner: readonly Monaco.editor.IMarkerData[],
  loser: readonly Monaco.editor.IMarkerData[],
): Monaco.editor.IMarkerData[] {
  const claimed = new Set(
    winner.filter(isError).map((marker) => marker.startLineNumber),
  );
  if (claimed.size === 0) {
    return [...loser];
  }
  return loser.filter((marker) => !isError(marker) || !claimed.has(marker.startLineNumber));
}

/**
 * `MarkerSeverity.Error` is 8. Read as a constant rather than off the Monaco
 * namespace so arbitration never depends on the API object being present.
 */
function isError(marker: Monaco.editor.IMarkerData): boolean {
  return marker.severity === 8;
}
