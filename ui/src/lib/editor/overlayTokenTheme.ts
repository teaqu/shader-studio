import {
  LIGHT_TO_DARK_TOKEN_COLORS,
  buildScopedTokenCss,
  countTokenColorRules,
} from "@shader-studio/monaco";

import type { Theme } from "../stores/themeStore";

/**
 * Monaco keeps one theme per page, so the shader-preview overlay cannot own
 * the global theme while a docked editor pane is open beside it. The global
 * theme follows the workspace instead, and the overlay's own token colours
 * come from scoped overrides of Monaco's generated `.mtkN` rules.
 */
export const OVERLAY_TOKEN_SCOPE_CLASS = "shader-studio-overlay-tokens";

const STYLE_ELEMENT_ID = "shader-studio-overlay-token-colors";
const OVERLAY_FALLBACK_COLOR = "#d4d4d4";
// Below this relative luminance an unmapped colour is unreadable on the
// overlay's dark text sheet.
const OVERLAY_MIN_LUMINANCE = 0.25;

// Monaco's generated stylesheet is an implementation detail, so a stylesheet
// that is present but yields no rules means an upgrade changed its shape.
// Left unreported that fails silently: the overlay keeps the light workspace
// tokens. An absent stylesheet is the ordinary pre-mount state, not a fault.
const MISSING_TOKEN_RULES_WARNING =
  "[shader-studio] Monaco emitted no .mtkN colour rules, so the editor overlay "
  + "cannot repaint its tokens for the light workspace theme. A Monaco upgrade "
  + "has probably changed the generated stylesheet.";

let overlayCount = 0;
let warnedMissingTokenRules = false;

function monacoColorsSheets(doc: Document): HTMLStyleElement[] {
  return Array.from(doc.querySelectorAll<HTMLStyleElement>("style.monaco-colors"));
}

function styleElement(doc: Document): HTMLStyleElement {
  const existing = doc.getElementById(STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) {
    return existing;
  }
  const style = doc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  doc.head.appendChild(style);
  return style;
}

/**
 * Repaint the overlay's token colours for the workspace theme now in force.
 * Call it after Monaco's global theme has been set, since the overrides are
 * derived from the class-to-colour rules that theme just generated.
 *
 * @returns the CSS written to the document, for tests and diagnostics.
 */
export function syncOverlayTokenColors(theme: Theme, doc: Document = document): string {
  if (overlayCount === 0) {
    return "";
  }
  // A dark workspace already paints the overlay's palette.
  if (theme === "dark") {
    styleElement(doc).textContent = "";
    return "";
  }
  const sheets = monacoColorsSheets(doc);
  const colorsCss = sheets.map((sheet) => sheet.textContent ?? "").join("\n");
  if (sheets.length > 0 && countTokenColorRules(colorsCss) === 0 && !warnedMissingTokenRules) {
    warnedMissingTokenRules = true;
    console.warn(MISSING_TOKEN_RULES_WARNING);
  }
  const css = buildScopedTokenCss(colorsCss, {
    selector: `.${OVERLAY_TOKEN_SCOPE_CLASS}`,
    translation: LIGHT_TO_DARK_TOKEN_COLORS,
    fallbackColor: OVERLAY_FALLBACK_COLOR,
    minRelativeLuminance: OVERLAY_MIN_LUMINANCE,
  });
  styleElement(doc).textContent = css;
  return css;
}

/** Register an overlay editor as a user of the scoped token colours. */
export function retainOverlayTokenColors(theme: Theme, doc: Document = document): string {
  overlayCount += 1;
  return syncOverlayTokenColors(theme, doc);
}

/** Drop the scoped overrides once the last overlay editor has gone. */
export function releaseOverlayTokenColors(doc: Document = document): void {
  overlayCount = Math.max(0, overlayCount - 1);
  if (overlayCount === 0) {
    doc.getElementById(STYLE_ELEMENT_ID)?.remove();
  }
}

/** Test seam: forget any overlays a previous test left registered. */
export function resetOverlayTokenColors(doc: Document = document): void {
  overlayCount = 0;
  warnedMissingTokenRules = false;
  doc.getElementById(STYLE_ELEMENT_ID)?.remove();
}
