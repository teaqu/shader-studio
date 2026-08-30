import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceCssPath = resolve(process.cwd(), 'ui/src/app.css');
const appCssPath = existsSync(workspaceCssPath)
  ? workspaceCssPath
  : resolve(process.cwd(), 'src/app.css');
const appCss = readFileSync(appCssPath, 'utf8');

function rule(selector: string): string {
  const match = appCss.match(new RegExp(`${selector.replace(/[.+]/g, '\\$&')}\\s*{[^}]*}`, 's'));
  expect(match, `${selector} is missing from app.css`).toBeTruthy();
  return match![0];
}

describe('pause error tooltip styles', () => {
  it('counts its own padding and border inside max-height', () => {
    // content-box would add 8px padding twice plus the border on top of the
    // measured cap, overrunning the top of a short pane.
    expect(rule('.error-tooltip')).toMatch(/box-sizing:\s*border-box;/);
  });

  it('takes its sheet from the editor theme rather than hard-coded colours', () => {
    const tooltip = rule('.error-tooltip');

    expect(tooltip).toMatch(/background-color:\s*var\(--vscode-editor-background\);/);
    expect(tooltip).toMatch(/color:\s*var\(--vscode-editor-foreground\);/);
    expect(tooltip).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('keeps the copy button readable on that sheet in either theme', () => {
    expect(rule('.error-tooltip .error-tooltip-copy'))
      .toMatch(/color:\s*var\(--vscode-descriptionForeground\);/);
    // button-foreground is white, which disappears against a light sheet.
    expect(rule('.error-tooltip .error-tooltip-copy:hover'))
      .toMatch(/color:\s*var\(--vscode-editor-foreground\);/);
  });

  it('keeps the tooltip itself out of preformatted mode', () => {
    // `pre-wrap` here renders the markup whitespace around the copy button as a
    // blank first line, which is what made the button look like it owned a row.
    expect(rule('.error-tooltip')).toMatch(/white-space:\s*normal;/);
  });

  it('never wraps a compiler block, so the caret keeps pointing at its token', () => {
    const block = rule('.error-tooltip-block');

    expect(block).toMatch(/white-space:\s*pre;/);
    expect(block).toMatch(/overflow-x:\s*auto;/);
    expect(block).not.toMatch(/word-break/);
  });

  it('separates one diagnostic from the next with a rule spanning the whole pane', () => {
    const separator = rule('.error-tooltip-block + .error-tooltip-block');
    const tooltipPadding = rule('.error-tooltip').match(/padding:\s*\d+px\s+(\d+)px;/);

    expect(separator).toMatch(/border-top:/);
    // Negative margins have to cancel the tooltip's own horizontal padding
    // exactly, or the rule stops short of the edge.
    expect(tooltipPadding?.[1]).toBe('12');
    expect(separator).toMatch(/margin-left:\s*-12px;/);
    expect(separator).toMatch(/margin-right:\s*-12px;/);
    expect(separator).toMatch(/padding:\s*8px 12px 4px;/);
  });

  it('insets only the block that sits under the copy button', () => {
    expect(rule('.error-tooltip-block:first-child')).toMatch(/padding-right:\s*18px;/);
    expect(rule('.error-tooltip-content')).toMatch(/padding-right:\s*0;/);
  });

  it('recolours that separator for warnings', () => {
    const warningSeparator = rule('.error-tooltip.warning .error-tooltip-block + .error-tooltip-block');

    expect(warningSeparator).toMatch(/var\(--shader-studio-warning-border\)/);
  });

  it('gives the tooltip room for a real diagnostic without swallowing the viewport', () => {
    const tooltip = rule('.error-tooltip');

    expect(tooltip).toMatch(/max-width:\s*min\(1100px,\s*92vw\);/);
    expect(tooltip).toMatch(/max-height:\s*min\(70vh,\s*640px\);/);
    expect(tooltip).toMatch(/overflow-y:\s*auto;/);
  });

  it('escapes the pane it is anchored in', () => {
    const tooltip = rule('.error-tooltip');

    // Portalled to the body and positioned from script: inside the dockview
    // pane it was clipped at the pane edge and painted over by other panels.
    expect(tooltip).toMatch(/position:\s*fixed;/);
    expect(tooltip).not.toMatch(/bottom:\s*100%;/);
    expect(tooltip).toMatch(/z-index:\s*2147483000;/);
  });

  it('does not swallow pointer events while it is hidden', () => {
    // It now covers the viewport's stacking order, so an invisible tooltip must
    // not sit in front of the UI underneath it.
    expect(rule('.error-tooltip')).toMatch(/pointer-events:\s*none;/);
    expect(rule('.error-tooltip.visible')).toMatch(/pointer-events:\s*auto;/);
  });

  it('keeps the copy button clear of the text', () => {
    expect(rule('.error-tooltip .error-tooltip-copy')).toMatch(/position:\s*absolute;/);
  });
});
