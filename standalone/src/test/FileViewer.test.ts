import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileViewer from '../FileViewer.svelte';
import { getRequestedEditor, resetShellState } from '../state/shellState.svelte';
import type { WebTransport } from '../WebTransport';

type TestTransport = WebTransport & {
  listWorkspaceFiles: ReturnType<typeof vi.fn>;
  onWorkspaceChange: ReturnType<typeof vi.fn>;
};

function createTransport(files: { path: string; modifiedAt: number }[]): TestTransport {
  return {
    listWorkspaceFiles: vi.fn().mockResolvedValue(files),
    onWorkspaceChange: vi.fn(() => () => {}),
  } as unknown as TestTransport;
}

describe('FileViewer', () => {
  beforeEach(() => {
    resetShellState();
  });

  it('lists every workspace file sorted with its directory', async () => {
    render(FileViewer, {
      transport: createTransport([
        { path: '/shaders/b.glsl', modifiedAt: 2 },
        { path: '/shaders/a.glsl', modifiedAt: 1 },
        { path: '/notes/todo.txt', modifiedAt: 3 },
      ]),
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-viewer')).toBeTruthy();
    });
    const rows = screen.getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('title'))).toEqual([
      '/notes/todo.txt',
      '/shaders/a.glsl',
      '/shaders/b.glsl',
    ]);
    expect(screen.getByLabelText('3 files')).toBeTruthy();
  });

  it('requests the editor for the clicked file', async () => {
    render(FileViewer, {
      transport: createTransport([{ path: '/notes/todo.txt', modifiedAt: 1 }]),
    });

    await waitFor(() => {
      expect(screen.getByTitle('/notes/todo.txt')).toBeTruthy();
    });
    await fireEvent.click(screen.getByTitle('/notes/todo.txt'));
    expect(getRequestedEditor()).toBe('/notes/todo.txt');
  });

  it('refreshes when the workspace changes and reports list failures', async () => {
    const workspaceEvents: { listener: (() => void) | null } = { listener: null };
    const transport = createTransport([{ path: '/a.glsl', modifiedAt: 1 }]);
    transport.onWorkspaceChange.mockImplementation((next: () => void) => {
      workspaceEvents.listener = next;
      return () => {};
    });
    render(FileViewer, { transport });

    await waitFor(() => {
      expect(screen.getByTitle('/a.glsl')).toBeTruthy();
    });
    transport.listWorkspaceFiles.mockResolvedValueOnce([{ path: '/a.glsl', modifiedAt: 1 }, { path: '/b.glsl', modifiedAt: 2 }]);
    workspaceEvents.listener?.();
    await waitFor(() => {
      expect(screen.getByTitle('/b.glsl')).toBeTruthy();
    });

    transport.listWorkspaceFiles.mockRejectedValueOnce(new Error('gone'));
    workspaceEvents.listener?.();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not list workspace files.');
    });
  });

  it('shows an empty note when the workspace has no files', async () => {
    render(FileViewer, { transport: createTransport([]) });
    await waitFor(() => {
      expect(screen.getByText('No files in this workspace yet.')).toBeTruthy();
    });
  });
});
