import { EditorView, ViewPlugin } from '@codemirror/view';

/** Keep the cursor above the keyboard and any floating touch controls. */
export function visibleScrollMargins(view: EditorView): { bottom: number } | null {
  const window = view.dom.ownerDocument.defaultView;
  const viewport = window?.visualViewport;
  if (!window || !viewport || viewport.scale !== 1) {
    return null;
  }
  const bounds = view.scrollDOM.getBoundingClientRect();
  const hidden = Math.max(0, bounds.bottom - (viewport.offsetTop + viewport.height));
  const controls = Number.parseFloat(window.getComputedStyle(view.dom).getPropertyValue('--cm-touch-scroll-clearance')) || 0;
  // Leave room for the optional single-row touch toolbar, but always retain
  // at least one line of usable space on very short landscape viewports.
  return hidden > 0 || controls > 0
    ? { bottom: Math.min(hidden + Math.max(controls, 40), Math.max(0, bounds.height - 40)) } : null;
}

export class ViewportScrollController {
  private readonly viewport: VisualViewport | null | undefined;
  private readonly window: Window | null;
  private frame = 0;
  private readonly changed = () => {
    if (!this.window || this.frame) {
      return;
    }
    this.frame = this.window.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.view.hasFocus && this.viewport?.scale === 1) {
        this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: 'nearest' }) });
      }
    });
  };

  constructor(private readonly view: EditorView) {
    this.window = view.dom.ownerDocument.defaultView;
    this.viewport = this.window?.visualViewport;
    this.viewport?.addEventListener('resize', this.changed);
    this.viewport?.addEventListener('scroll', this.changed);
  }

  destroy(): void {
    this.window?.cancelAnimationFrame(this.frame);
    this.viewport?.removeEventListener('resize', this.changed);
    this.viewport?.removeEventListener('scroll', this.changed);
  }
}

export const visibleEditorViewport = [
  EditorView.scrollMargins.of(visibleScrollMargins),
  ViewPlugin.fromClass(ViewportScrollController),
];
