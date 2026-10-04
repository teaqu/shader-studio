import { beforeEach, describe, expect, it } from 'vitest';
import {
  createEditorSelectionSource,
  getEditorSelection,
  resetEditorSelectionState,
  setEditorSelection,
} from '../../lib/state/editorSelectionState.svelte';

describe('shared editor selection state', () => {
  beforeEach(resetEditorSelectionState);

  it('shares cursor and selection by document without leaking between files', () => {
    const overlay = createEditorSelectionSource();
    const pane = createEditorSelectionSource();
    expect(pane).not.toBe(overlay);
    setEditorSelection('/shader.glsl', overlay, {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 4,
      endColumn: 5,
    });
    expect(getEditorSelection('/shader.glsl')).toEqual({
      source: overlay,
      selection: { startLineNumber: 2, startColumn: 3, endLineNumber: 4, endColumn: 5 },
    });
    expect(getEditorSelection('/other.glsl')).toBeNull();
  });

  it('ignores an empty document path', () => {
    setEditorSelection('', createEditorSelectionSource(), {
      startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1,
    });
    expect(getEditorSelection('')).toBeNull();
  });
});
