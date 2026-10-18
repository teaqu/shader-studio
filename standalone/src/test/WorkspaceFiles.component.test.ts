import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceFiles from '../WorkspaceFiles.svelte';
import type { WebTransport } from '../WebTransport';
import type { WorkspaceFileEntry } from '../workspaceFiles';

it('prevents a second file operation while an upload is still saving', async () => {
  const { api } = setup();
  let finish: () => void = () => {};
  api.uploadFiles.mockImplementation(() => new Promise<void>(resolve => {
    finish = resolve;
  }));
  await fireEvent.change(screen.getByLabelText('Upload to workspace folder'), { target: { files: [new File(['x'], 'a.png')] } });
  const confirm = vi.spyOn(window, 'confirm');
  await fireEvent.keyDown(screen.getByRole('tree'), { key: 'Delete' });
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(api.readEditorFile).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect((screen.getByRole('button', { name: 'Upload to folder' }) as HTMLButtonElement).disabled).toBe(false));
});

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

function setup(initial: WorkspaceFileEntry[] = [{ path: '/shaders/main.glsl', asset: false }, { path: '/shaders/main.sha.json', asset: false }, { path: '/shaders/photo.png', asset: true }]) {
  let files = initial;
  let publish: (files: WorkspaceFileEntry[]) => void = () => {};
  const stop = vi.fn();
  const api = {
    onWorkspaceFiles: vi.fn(listener => {
      publish = listener; listener(files); return stop;
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    readEditorFile: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
    createWorkspaceFile: vi.fn(async (path: string) => {
      files = [...files, { path, asset: false }]; publish(files);
    }),
    renameWorkspacePath: vi.fn(async (from: string, to: string) => {
      files = files.map(file => ({ ...file, path: file.path === from ? to : file.path })); publish(files);
    }),
    deleteWorkspacePath: vi.fn(async (path: string) => {
      files = files.filter(file => file.path !== path && !file.path.startsWith(`${path}/`)); publish(files);
    }),
    uploadFiles: vi.fn().mockResolvedValue([]),
  };
  const onOpen = vi.fn();
  const onPathsRemoved = vi.fn();
  const app = render(WorkspaceFiles, { transport: api as unknown as WebTransport, onOpen, onPathsRemoved });
  return { ...app, api, onOpen, onPathsRemoved, stop, publish: (next: WorkspaceFileEntry[]) => publish(next) };
}

it('shows folders, filters files, collapses folders and opens text sources', async () => {
  const { onOpen, unmount, stop } = setup();
  await fireEvent.click(screen.getByRole('treeitem', { name: 'shaders' }));
  expect(screen.queryByRole('treeitem', { name: 'main.glsl' })).toBeNull();
  await fireEvent.input(screen.getByLabelText('Filter workspace files'), { target: { value: 'MAIN.GLSL' } });
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  expect(onOpen).toHaveBeenCalledWith('/shaders/main.glsl');
  await fireEvent.input(screen.getByLabelText('Filter workspace files'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching files.')).toBeTruthy();
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it('creates nested files, cancels a form and renames a selected file', async () => {
  const { api, onOpen, onPathsRemoved } = setup();
  await fireEvent.click(screen.getByRole('button', { name: 'New file' }));
  expect((screen.getByLabelText('New file path') as HTMLInputElement).value).toBe('/shaders/untitled.glsl');
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('New file path')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'New file' }));
  await fireEvent.input(screen.getByLabelText('New file path'), { target: { value: 'nested/new.txt' } });
  await fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
  expect(api.createWorkspaceFile).toHaveBeenCalledWith('/nested/new.txt');
  expect(onOpen).toHaveBeenCalledWith('/nested/new.txt');
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  await fireEvent.input(screen.getByLabelText('Rename or move path'), { target: { value: '/shaders/renamed.glsl' } });
  await fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
  expect(api.renameWorkspacePath).toHaveBeenCalledWith('/shaders/main.glsl', '/shaders/renamed.glsl');
  expect(onPathsRemoved).toHaveBeenCalledWith(['/shaders/main.glsl', '/shaders/main.sha.json']);
});

it.each([true, false])('confirms deleting a folder and can cancel (confirmed: %s)', async confirmed => {
  const { api, onPathsRemoved } = setup();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(confirmed);
  await fireEvent.click(screen.getByRole('treeitem', { name: 'shaders' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('everything inside it'));
  if (confirmed) {
    expect(api.deleteWorkspacePath).toHaveBeenCalledWith('/shaders');
    expect(onPathsRemoved).toHaveBeenCalledWith(['/shaders/main.glsl', '/shaders/main.sha.json', '/shaders/photo.png']);
    expect(screen.getByText(/No files yet/)).toBeTruthy();
  } else {
    expect(api.deleteWorkspacePath).not.toHaveBeenCalled();
  }
});

it('uploads into the selected folder, resets the file input and ignores cancellation', async () => {
  const { api } = setup();
  await fireEvent.click(screen.getByRole('treeitem', { name: 'shaders' }));
  const input = screen.getByLabelText('Upload to workspace folder') as HTMLInputElement;
  const click = vi.spyOn(input, 'click');
  await fireEvent.click(screen.getByRole('button', { name: 'Upload to folder' }));
  expect(click).toHaveBeenCalledOnce();
  await fireEvent.change(input, { target: { files: [] } });
  expect(api.uploadFiles).not.toHaveBeenCalled();
  const file = new File(['image'], 'photo.png');
  await fireEvent.change(input, { target: { files: [file] } });
  expect(api.uploadFiles).toHaveBeenCalledWith([file], '/shaders');
  expect(input.value).toBe('');
});

it.each(['data:image/png;base64,AA==', 'data:video/mp4;base64,AA==', 'data:audio/ogg;base64,AA==', 'data:application/octet-stream;base64,AA=='])('previews supported media or explains unavailable previews: %s', async contents => {
  const { api, publish } = setup();
  api.readEditorFile.mockResolvedValue(contents);
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }));
  const dialog = await screen.findByRole('dialog', { name: 'Asset preview' });
  expect(dialog.textContent).toContain('/shaders/photo.png');
  if (contents.startsWith('data:image')) {
    expect(screen.getByRole('img')).toBeTruthy();
  } else if (contents.startsWith('data:video')) {
    expect(dialog.querySelector('video')).toBeTruthy();
  } else if (contents.startsWith('data:audio')) {
    expect(dialog.querySelector('audio')).toBeTruthy();
  } else {
    expect(dialog.textContent).toContain('Preview is unavailable');
  }
  publish([]);
  await tick();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes previews with the close button and Escape, and hides context menus on click', async () => {
  setup();
  const row = screen.getByRole('treeitem', { name: 'photo.png' });
  await fireEvent.click(row);
  await fireEvent.click(await screen.findByRole('button', { name: 'Close asset preview' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await fireEvent.click(row);
  await fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
  expect(screen.getByRole('menu')).toBeTruthy();
  await fireEvent.click(window);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('downloads assets directly and revokes temporary URLs for source downloads', async () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn().mockReturnValue('blob:download');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const { api } = setup();
  await fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'photo.png' }));
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
  expect((click.mock.instances[0] as HTMLAnchorElement).getAttribute('href')).toBe('data:image/png;base64,AA==');
  expect(createObjectURL).not.toHaveBeenCalled();
  api.readEditorFile.mockResolvedValue('source');
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(createObjectURL).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
});

it('shows missing-file and operation errors without leaving the UI busy', async () => {
  const { api } = setup();
  api.readEditorFile.mockResolvedValue(null);
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }));
  expect((await screen.findByRole('alert')).textContent).toContain('no longer exists');
  await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(screen.getByRole('alert').textContent).toContain('no longer exists');
  api.uploadFiles.mockRejectedValue('failed');
  await fireEvent.change(screen.getByLabelText('Upload to workspace folder'), { target: { files: [new File(['x'], 'a.png')] } });
  expect(screen.getByRole('alert').textContent).toContain('Could not complete');
  expect((screen.getByRole('button', { name: 'Upload to folder' }) as HTMLButtonElement).disabled).toBe(false);
});

it('supports keyboard selection, folder expansion, rename, context actions and deletion', async () => {
  const { api } = setup();
  const tree = screen.getByRole('tree');
  await fireEvent.keyDown(tree, { key: 'ArrowDown' });
  expect(screen.getByRole('treeitem', { name: 'shaders' }).getAttribute('aria-selected')).toBe('true');
  await fireEvent.keyDown(tree, { key: 'ArrowLeft' });
  expect(screen.queryByRole('treeitem', { name: 'main.glsl' })).toBeNull();
  await fireEvent.keyDown(tree, { key: 'ArrowRight' });
  await fireEvent.keyDown(tree, { key: 'End' });
  await fireEvent.keyDown(tree, { key: 'ArrowUp' });
  await fireEvent.keyDown(tree, { key: 'Home' });
  await fireEvent.keyDown(tree, { key: 'F2' });
  expect(screen.getByLabelText('Rename or move path')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Escape' });
  await fireEvent.contextMenu(screen.getByRole('treeitem', { name: 'shaders' }));
  expect(screen.queryByRole('menuitem', { name: 'Download' })).toBeNull();
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename / Move…' }));
  expect(screen.getByLabelText('Rename or move path')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Escape' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await fireEvent.keyDown(tree, { key: 'Delete' });
  await waitFor(() => expect(api.deleteWorkspacePath).toHaveBeenCalledWith('/shaders'));
  await fireEvent.keyDown(tree, { key: 'ArrowDown' });
  await fireEvent.keyDown(tree, { key: 'x' });
});
