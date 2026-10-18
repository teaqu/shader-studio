import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceFiles from '../lib/FileExplorer.svelte';
import type { FileExplorerHost } from '../lib/FileExplorerHost';
import type { WorkspaceFileEntry } from '../lib/FileExplorerHost';

function dropDeviceFiles(files: File[], target = screen.getByRole('tree')) {
  return fireEvent.drop(target, { dataTransfer: { types: ['Files'], files, getData: () => '' } });
}

it.each([[], null])('cancels device selection without changing the workspace (%s)', async files => {
  const { api } = setup();
  await fireEvent.change(screen.getByLabelText('Upload files'), { target: { files } });
  expect(api.uploadFiles).not.toHaveBeenCalled();
});

it('disables device uploads while saving and reports a single-file completion', async () => {
  const { api } = setup();
  let finishUpload: () => void = () => {};
  api.uploadFiles.mockImplementationOnce(() => new Promise<void>(resolve => {
    finishUpload = resolve;
  }));
  const file = new File(['source'], 'single.glsl');
  await fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [file] } });
  expect(api.uploadFiles).toHaveBeenCalledWith([file], '/');
  expect((screen.getByRole('button', { name: 'Upload Files' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Added 1 file to /.')).toBeNull();
  finishUpload();
  await screen.findByText('Added 1 file to /.');
  expect((screen.getByRole('button', { name: 'Upload Files' }) as HTMLButtonElement).disabled).toBe(false);
});

it('supports Ctrl toggles, Shift ranges and selecting all files', async () => {
  setup();
  const main = screen.getByRole('treeitem', { name: 'main.glsl' });
  const config = screen.getByRole('treeitem', { name: 'main.sha.json' });
  const photo = screen.getByRole('treeitem', { name: 'photo.png' });
  await fireEvent.click(main);
  await fireEvent.click(config, { ctrlKey: true });
  expect(main.getAttribute('aria-selected')).toBe('true');
  expect(config.getAttribute('aria-selected')).toBe('true');
  await fireEvent.click(config, { ctrlKey: true });
  expect(config.getAttribute('aria-selected')).toBe('false');
  await fireEvent.click(main);
  await fireEvent.click(photo, { shiftKey: true });
  expect(config.getAttribute('aria-selected')).toBe('true');
  expect(photo.getAttribute('aria-selected')).toBe('true');
  await fireEvent.keyDown(screen.getByRole('tree'), { key: 'a', ctrlKey: true });
  expect(screen.getAllByRole('treeitem').every(row => row.getAttribute('aria-selected') === 'true')).toBe(true);
});

it('offers a visible Select mode that selects files without opening them', async () => {
  const { onOpen, api } = setup();
  const button = screen.getByRole('button', { name: 'Select multiple files' });
  await fireEvent.click(button);
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }));
  expect(screen.getByRole('treeitem', { name: 'main.glsl' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('treeitem', { name: 'photo.png' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('FILES')).toBeTruthy();
  expect(onOpen).not.toHaveBeenCalled();
  expect(api.readEditorFile).not.toHaveBeenCalled();
  expect(button.getAttribute('aria-pressed')).toBe('true');
  await fireEvent.click(button);
  expect(button.getAttribute('aria-pressed')).toBe('false');
});

it('offers device selection in Files, defaults to root, and creates empty folders', async () => {
  const { api } = setup();
  const input = screen.getByLabelText('Upload files') as HTMLInputElement;
  const choose = vi.spyOn(input, 'click');
  await fireEvent.click(screen.getByRole('button', { name: 'Upload Files' }));
  expect(choose).toHaveBeenCalledOnce();
  await fireEvent.change(input, { target: { files: [] } });
  expect(api.uploadFiles).not.toHaveBeenCalled();
  const file = new File(['x'], 'new.png');
  await fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(api.uploadFiles).toHaveBeenCalledWith([file], '/'));
  await fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  const path = screen.getByLabelText('New folder path');
  expect((path as HTMLInputElement).value).toBe('/new-folder');
  await fireEvent.input(path, { target: { value: '/assets' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(api.createWorkspaceFolder).toHaveBeenCalledWith('/assets');
});

it('negotiates file drags without intercepting pane drags and ignores same-folder moves', async () => {
  const { api } = setup();
  const tree = screen.getByRole('tree');
  const row = screen.getByRole('treeitem', { name: 'photo.png' });
  const setData = vi.fn();
  const transfer = { types: ['application/x-shader-studio-path'], files: [], getData: () => '/shaders/photo.png', setData, effectAllowed: '', dropEffect: '' };
  await fireEvent.dragStart(row, { dataTransfer: transfer });
  expect(setData).toHaveBeenCalledWith('application/x-shader-studio-path', '/shaders/photo.png');
  expect(transfer.effectAllowed).toBe('move');
  await fireEvent.dragOver(row, { dataTransfer: transfer });
  expect(transfer.dropEffect).toBe('move');
  await fireEvent.drop(row, { dataTransfer: transfer });
  expect(api.renameWorkspacePath).not.toHaveBeenCalled();
  const external = { ...transfer, types: ['Files'] };
  await fireEvent.dragOver(tree, { dataTransfer: external });
  expect(external.dropEffect).toBe('copy');
  await fireEvent.dragLeave(tree);
  await fireEvent.dragEnd(row);
  await fireEvent.dragStart(row);
  await fireEvent.dragOver(tree);
  await fireEvent.drop(tree, { dataTransfer: { types: ['dockview'], files: [] } });
  expect(api.uploadFiles).not.toHaveBeenCalled();
});

it('accepts dropped device files into a folder and moves internal file drags', async () => {
  const { api, onPathsRemoved } = setup();
  const image = new File(['image'], 'dropped.png');
  const directory = screen.getByRole('treeitem', { name: 'shaders' });
  await fireEvent.drop(directory, { dataTransfer: { types: ['Files'], files: [image], getData: () => '' } });
  expect(api.uploadFiles).toHaveBeenCalledWith([image], '/shaders');
  const photo = screen.getByRole('treeitem', { name: 'photo.png' });
  expect(photo.getAttribute('draggable')).toBe('true');
  await fireEvent.drop(screen.getByRole('tree'), { dataTransfer: {
    types: ['application/x-shader-studio-path'], files: [], getData: () => '/shaders/photo.png',
  } });
  expect(api.renameWorkspacePath).toHaveBeenCalledWith('/shaders/photo.png', '/photo.png');
  expect(onPathsRemoved).toHaveBeenCalledWith(['/shaders/photo.png']);
});

it('prevents a second file operation while an upload is still saving', async () => {
  const { api } = setup();
  let finish: () => void = () => {};
  api.uploadFiles.mockImplementation(() => new Promise<void>(resolve => {
    finish = resolve;
  }));
  await dropDeviceFiles([new File(['x'], 'a.png')]);
  const confirm = vi.spyOn(window, 'confirm');
  await fireEvent.keyDown(screen.getByRole('tree'), { key: 'Delete' });
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(api.readEditorFile).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect((screen.getByRole('button', { name: 'New folder' }) as HTMLButtonElement).disabled).toBe(false));
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
    createWorkspaceFolder: vi.fn(async (path: string) => {
      files = [...files, { path, asset: false, directory: true }]; publish(files);
    }),
    renameWorkspacePath: vi.fn(async (from: string, to: string) => {
      files = files.map(file => ({ ...file, path: file.path === from ? to : file.path })); publish(files);
    }),
    deleteWorkspacePath: vi.fn(async (path: string) => {
      files = files.filter(file => file.path !== path && !file.path.startsWith(`${path}/`)); publish(files);
    }),
    deleteWorkspacePaths: vi.fn().mockResolvedValue(undefined),
    moveWorkspacePaths: vi.fn().mockResolvedValue(undefined),
    uploadFiles: vi.fn().mockResolvedValue([]),
  };
  const onOpen = vi.fn();
  const onPathsRemoved = vi.fn();
  const app = render(WorkspaceFiles, { transport: api as unknown as FileExplorerHost, onOpen, onPathsRemoved });
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
  expect((screen.getByLabelText('New file path') as HTMLInputElement).value).toBe('/untitled.glsl');
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

it('uploads dropped files into the target folder and ignores an empty drop', async () => {
  const { api } = setup();
  const directory = screen.getByRole('treeitem', { name: 'shaders' });
  await dropDeviceFiles([], directory);
  expect(api.uploadFiles).not.toHaveBeenCalled();
  const file = new File(['image'], 'photo.png');
  await dropDeviceFiles([file], directory);
  expect(api.uploadFiles).toHaveBeenCalledWith([file], '/shaders');
  expect(screen.getByRole('status').textContent).toContain('Added 1 file to /shaders.');
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
  await vi.waitFor(() => expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(false));
  api.readEditorFile.mockResolvedValue('source');
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await vi.runAllTimersAsync();
  expect(createObjectURL).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
});

it('moves and deletes multiple selected paths and carries shader configs only once', async () => {
  const { api, onPathsRemoved } = setup();
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.sha.json' }), { ctrlKey: true });
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }), { metaKey: true });
  const transfer = {
    types: ['application/x-shader-studio-path', 'application/x-shader-studio-paths'], files: [],
    getData: (type: string) => type.endsWith('-paths') ? JSON.stringify(['/shaders/main.glsl', '/shaders/photo.png']) : '/shaders/main.glsl',
  };
  await fireEvent.drop(screen.getByRole('tree'), { dataTransfer: transfer });
  expect(api.moveWorkspacePaths).toHaveBeenCalledWith(['/shaders/main.glsl', '/shaders/photo.png'], '/');
  expect(onPathsRemoved).toHaveBeenCalledWith(['/shaders/main.glsl', '/shaders/main.sha.json', '/shaders/photo.png']);
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.glsl' }));
  await fireEvent.click(screen.getByRole('treeitem', { name: 'main.sha.json' }), { ctrlKey: true });
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }), { ctrlKey: true });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(api.deleteWorkspacePaths).toHaveBeenCalledWith(['/shaders/main.glsl', '/shaders/photo.png']);
});

it('downloads a selected folder as a ZIP and cleans up the download URL', async () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn().mockReturnValue('blob:archive');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  setup();
  await fireEvent.click(screen.getByRole('treeitem', { name: 'shaders' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('shaders.zip');
  await vi.runAllTimersAsync();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:archive');
});

it('shows missing-file and operation errors without leaving the UI busy', async () => {
  const { api } = setup();
  api.readEditorFile.mockResolvedValue(null);
  await fireEvent.click(screen.getByRole('treeitem', { name: 'photo.png' }));
  expect((await screen.findByRole('alert')).textContent).toContain('no longer exists');
  await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect((await screen.findByRole('alert')).textContent).toContain('no longer exists');
  api.uploadFiles.mockRejectedValue('failed');
  await dropDeviceFiles([new File(['x'], 'a.png')]);
  expect(screen.getByRole('alert').textContent).toContain('Could not complete');
  expect((screen.getByRole('button', { name: 'New folder' }) as HTMLButtonElement).disabled).toBe(false);
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
  expect(screen.getByRole('menuitem', { name: 'Download' })).toBeTruthy();
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename / Move…' }));
  expect(screen.getByLabelText('Rename or move path')).toBeTruthy();
  await fireEvent.keyDown(window, { key: 'Escape' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await fireEvent.keyDown(tree, { key: 'Delete' });
  await waitFor(() => expect(api.deleteWorkspacePath).toHaveBeenCalledWith('/shaders'));
  await fireEvent.keyDown(tree, { key: 'ArrowDown' });
  await fireEvent.keyDown(tree, { key: 'x' });
});
