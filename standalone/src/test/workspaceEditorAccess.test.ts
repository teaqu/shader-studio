import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getModel: vi.fn(), file: vi.fn(path => `file://${path}`) }));
vi.mock('monaco-editor/editor/editor.api.js', () => ({ Uri: { file: mocks.file }, editor: { getModel: mocks.getModel } }));
import { workspaceEditorAccess } from '../workspaceEditorAccess';
beforeEach(() => {
  mocks.getModel.mockReset();
});
describe('workspace editor access', () => {
  it('reads shared live models and tolerates unopened files', () => {
    expect(workspaceEditorAccess.read('/closed.glsl')).toBeUndefined();
    mocks.getModel.mockReturnValue({ getValue: () => 'draft' });
    expect(workspaceEditorAccess.read('/open.glsl')).toBe('draft');
    expect(mocks.getModel).toHaveBeenLastCalledWith('file:///open.glsl');
  });
  it('applies one undoable edit to a focused shared model', () => {
    const model = { getValue: () => 'before', pushStackElement: vi.fn(), pushEditOperations: vi.fn(), getFullModelRange: () => 'range' };
    mocks.getModel.mockReturnValue(model);
    workspaceEditorAccess.commit('/open.glsl', 'after');
    expect(model.pushStackElement).toHaveBeenCalledTimes(2);
    expect(model.pushEditOperations).toHaveBeenCalledWith(null, [{ range: 'range', text: 'after' }], expect.any(Function));
    expect(model.pushEditOperations.mock.calls[0][2]()).toBeNull();
  });
  it('leaves equal and absent models alone', () => {
    workspaceEditorAccess.commit('/closed.glsl', 'after');
    const model = { getValue: () => 'after', pushStackElement: vi.fn() };
    mocks.getModel.mockReturnValue(model);
    workspaceEditorAccess.commit('/open.glsl', 'after');
    expect(model.pushStackElement).not.toHaveBeenCalled();
  });
});
