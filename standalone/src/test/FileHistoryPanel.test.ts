import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FileHistoryPanel from '../FileHistoryPanel.svelte';
import { setViewerSession } from '@shader-studio/ui/lib/state/viewerSession.svelte';
import type { FileRevision } from '../FileHistory';
import type { WebTransport } from '../WebTransport';

function revision(path: string, id: string, contents: string): FileRevision {
  return { id, path, contents, timestamp: 1000, size: contents.length };
}

function createTransport(revisionsByPath: Record<string, FileRevision[]> = {}) {
  let listener: () => void = () => {};
  return {
    listFileRevisions: vi.fn((path: string) => Promise.resolve(revisionsByPath[path] ?? [])),
    restoreFileRevision: vi.fn().mockResolvedValue(true),
    clearFileHistory: vi.fn().mockResolvedValue(undefined),
    onHistoryChange: vi.fn((handler: () => void) => {
      listener = handler;
      return () => {};
    }),
    emitHistoryChange: () => listener(),
  };
}

type StubTransport = ReturnType<typeof createTransport>;

function renderPanel(transport: StubTransport) {
  return render(FileHistoryPanel, { props: { transport: transport as unknown as WebTransport } });
}

describe('FileHistoryPanel', () => {
  it('asks for an open file when nothing is active', async () => {
    setViewerSession(null);
    const transport = createTransport({ '/a.glsl': [revision('/a.glsl', 'a1', 'a-contents')] });
    renderPanel(transport);

    await waitFor(() => {
      expect(screen.getByText('Open a file to see its edit history.')).toBeTruthy();
    });
    expect(transport.listFileRevisions).not.toHaveBeenCalled();
  });

  it('shows an empty state for the active file without revisions', async () => {
    setViewerSession({ shaderPath: '/b.glsl' } as never);
    renderPanel(createTransport());
    try {
      await waitFor(() => {
        expect(screen.getByText('/b.glsl')).toBeTruthy();
      });
      expect(screen.getByText('No revisions for this file yet. History appears after you edit it.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Clear history' })).toBeNull();
    } finally {
      setViewerSession(null);
    }
  });

  it('lists the active file revisions without a file picker', async () => {
    setViewerSession({ shaderPath: '/b.glsl' } as never);
    const transport = createTransport({
      '/a.glsl': [revision('/a.glsl', 'a1', 'a-contents')],
      '/b.glsl': [revision('/b.glsl', 'b1', 'b-contents')],
    });
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByText(/10 chars/)).toBeTruthy();
      });
      expect(screen.queryByLabelText('File')).toBeNull();
      expect(transport.listFileRevisions).toHaveBeenCalledWith('/b.glsl');
      expect(transport.listFileRevisions).not.toHaveBeenCalledWith('/a.glsl');
    } finally {
      setViewerSession(null);
    }
  });

  it('follows the active file when it changes', async () => {
    setViewerSession({ shaderPath: '/a.glsl' } as never);
    const transport = createTransport({
      '/a.glsl': [revision('/a.glsl', 'a1', 'a-contents')],
      '/b.glsl': [revision('/b.glsl', 'b1', 'b-contents')],
    });
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByText(/10 chars/)).toBeTruthy();
      });
      expect(transport.listFileRevisions).toHaveBeenLastCalledWith('/a.glsl');

      setViewerSession({ shaderPath: '/b.glsl' } as never);
      await waitFor(() => {
        expect(transport.listFileRevisions).toHaveBeenLastCalledWith('/b.glsl');
      });
    } finally {
      setViewerSession(null);
    }
  });

  it('restores the selected revision', async () => {
    setViewerSession({ shaderPath: '/b.glsl' } as never);
    const transport = createTransport({
      '/b.glsl': [revision('/b.glsl', 'b1', 'b-contents')],
    });
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await waitFor(() => {
        expect(transport.restoreFileRevision).toHaveBeenCalledWith('/b.glsl', 'b1');
      });
    } finally {
      setViewerSession(null);
    }
  });

  it('clears the active file history and refreshes', async () => {
    setViewerSession({ shaderPath: '/b.glsl' } as never);
    const revisions = { '/b.glsl': [revision('/b.glsl', 'b1', 'b-contents')] };
    const transport = createTransport(revisions);
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Clear history' })).toBeTruthy();
      });
      revisions['/b.glsl'] = [];
      await fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
      await waitFor(() => {
        expect(transport.clearFileHistory).toHaveBeenCalledWith('/b.glsl');
      });
      await waitFor(() => {
        expect(screen.getByText('No revisions for this file yet. History appears after you edit it.')).toBeTruthy();
      });
    } finally {
      setViewerSession(null);
    }
  });

  it('reports clear failures', async () => {
    setViewerSession({ shaderPath: '/b.glsl' } as never);
    const transport = createTransport({ '/b.glsl': [revision('/b.glsl', 'b1', 'b-contents')] });
    transport.clearFileHistory.mockRejectedValueOnce(new Error('db gone'));
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Clear history' })).toBeTruthy();
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe('Could not clear file history.');
      });
    } finally {
      setViewerSession(null);
    }
  });

  it('reports an unavailable revision without crashing', async () => {
    setViewerSession({ shaderPath: '/a.glsl' } as never);
    const transport = createTransport({ '/a.glsl': [revision('/a.glsl', 'a1', 'a-contents')] });
    transport.restoreFileRevision.mockResolvedValue(false);
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe('That revision is no longer available.');
      });
    } finally {
      setViewerSession(null);
    }
  });

  it('reports load failures', async () => {
    setViewerSession({ shaderPath: '/a.glsl' } as never);
    const transport = createTransport();
    transport.listFileRevisions.mockRejectedValueOnce(new Error('db gone'));
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe('Could not load file history.');
      });
    } finally {
      setViewerSession(null);
    }
  });

  it('paginates long revision lists twenty at a time', async () => {
    setViewerSession({ shaderPath: '/big.glsl' } as never);
    const all = Array.from({ length: 25 }, (_, index) =>
      revision('/big.glsl', `r${index}`, `contents-${index}`),
    );
    const transport = createTransport({ '/big.glsl': all });
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeTruthy();
      });
      expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(20);
      expect((screen.getByRole('button', { name: 'Newer' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Older' }) as HTMLButtonElement).disabled).toBe(false);

      await fireEvent.click(screen.getByRole('button', { name: 'Older' }));
      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeTruthy();
      });
      expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(5);
      expect((screen.getByRole('button', { name: 'Older' }) as HTMLButtonElement).disabled).toBe(true);

      await fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeTruthy();
      });
      expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(20);
    } finally {
      setViewerSession(null);
    }
  });

  it('hides the pager for short lists and resets the page on file switch', async () => {
    setViewerSession({ shaderPath: '/big.glsl' } as never);
    const all = Array.from({ length: 21 }, (_, index) =>
      revision('/big.glsl', `r${index}`, `contents-${index}`),
    );
    const transport = createTransport({
      '/big.glsl': all,
      '/small.glsl': [revision('/small.glsl', 's1', 'small')],
    });
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeTruthy();
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Older' }));
      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeTruthy();
      });

      setViewerSession({ shaderPath: '/small.glsl' } as never);
      await waitFor(() => {
        expect(screen.getByText(/5 chars/)).toBeTruthy();
      });
      expect(screen.queryByText(/Page \d+ of/)).toBeNull();

      setViewerSession({ shaderPath: '/big.glsl' } as never);
      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeTruthy();
      });
      expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(20);
    } finally {
      setViewerSession(null);
    }
  });

  it('refreshes when the history changes', async () => {
    setViewerSession({ shaderPath: '/a.glsl' } as never);
    const transport = createTransport({ '/a.glsl': [revision('/a.glsl', 'a1', 'a-contents')] });
    renderPanel(transport);
    try {
      await waitFor(() => {
        expect(transport.onHistoryChange).toHaveBeenCalledOnce();
      });
      transport.listFileRevisions.mockResolvedValueOnce([
        revision('/a.glsl', 'a1', 'a-contents'),
        revision('/a.glsl', 'a2', 'a2-contents'),
      ]);
      transport.emitHistoryChange();
      await waitFor(() => {
        expect(screen.getByText(/11 chars/)).toBeTruthy();
      });
    } finally {
      setViewerSession(null);
    }
  });
});
