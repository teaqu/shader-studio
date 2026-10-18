import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
const host = vi.hoisted(() => ({ groups: [] as { viewColumn: number; tabs: { input: unknown; label: string }[] }[], show: vi.fn(), close: vi.fn(), exists: vi.fn(() => true) }));
vi.mock('node:fs', () => ({ existsSync: host.exists }));
vi.mock('vscode', () => {
  class TabInputText {
 constructor(public uri: { fsPath: string }) {} 
}
  return {
    TabInputText, ViewColumn: { Beside: -2 }, Uri: { file: (fsPath: string) => ({ fsPath }) },
    window: {
      onDidChangeActiveTextEditor: () => ({ dispose: vi.fn() }),
      showTextDocument: host.show,
      tabGroups: { get all() {
 return host.groups; 
}, close: host.close },
    },
  };
});
import * as vscode from 'vscode';
import { ActiveShaderEditors } from '../../app/ActiveShaderEditors.js';
const file = (name: string) => path.resolve('test-shaders', name);
const payload = (name: string, buffers: string[] = []) => ({ shaderPath: file(`${name}.glsl`), files: [file(`${name}.glsl`), ...buffers.map(file)] });
const openPaths = () => host.groups.flatMap(group => group.tabs.map(tab => (tab.input as vscode.TabInputText).uri.fsPath));

beforeEach(() => {
  vi.clearAllMocks();
  host.exists.mockReturnValue(true);
  host.groups = [{ viewColumn: 1, tabs: [] }];
  host.show.mockImplementation(async (uri, options) => {
    let group = host.groups.find(group => group.viewColumn === options.viewColumn);
    if (!group) {
      group = { viewColumn: host.groups.length + 1, tabs: [] };
      host.groups.push(group);
    }
    group.tabs.push({ input: new vscode.TabInputText(uri), label: path.basename(uri.fsPath) });
    return { viewColumn: group.viewColumn };
  });
  host.close.mockImplementation(async tab => {
    for (const group of host.groups) {
      group.tabs = group.tabs.filter(candidate => candidate !== tab);
    }
    return true;
  });
});

describe('ActiveShaderEditors', () => {
  it('is opt-in and opens linked sources without the config when enabled', async () => {
    const manager = new ActiveShaderEditors();
    await manager.update({}, payload('one', ['buffer.glsl']));
    expect(host.show).not.toHaveBeenCalled();
    await manager.setEnabled(true);
    expect(openPaths()).toEqual([file('buffer.glsl'), file('one.glsl')]);
    expect(host.show).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ preview: false, preserveFocus: true }));
    manager.dispose();
  });

  it('maintains independent groups and shared files for two previews', async () => {
    const manager = new ActiveShaderEditors();
    const first = {}, second = {};
    await manager.setEnabled(true);
    await manager.update(first, payload('one', ['shared.glsl']));
    await manager.update(second, payload('two', ['shared.glsl']));
    expect(host.groups).toHaveLength(2);
    expect(host.groups[0].tabs.map(tab => tab.label)).toContain('one.glsl');
    expect(host.groups[1].tabs.map(tab => tab.label)).toContain('two.glsl');
    await manager.update(first, payload('three'));
    expect(openPaths()).not.toContain(file('one.glsl'));
    expect(openPaths()).toContain(file('two.glsl'));
    expect(openPaths()).toContain(file('shared.glsl'));
    await manager.remove(second);
    expect(openPaths()).not.toContain(file('two.glsl'));
    manager.dispose();
  });

  it('uses the native close prompt, keeps cancelled tabs and unrelated files', async () => {
    const manager = new ActiveShaderEditors();
    const preview = {};
    host.groups[0].tabs.push({ input: new vscode.TabInputText(vscode.Uri.file(file('notes.txt'))), label: 'notes.txt' });
    host.groups[0].tabs.push({ input: new vscode.TabInputText(vscode.Uri.file(file('old.glsl'))), label: 'old.glsl' });
    await manager.setEnabled(true);
    await manager.update(preview, payload('one'));
    expect(openPaths()).not.toContain(file('old.glsl'));
    host.close.mockResolvedValue(false);
    await manager.update(preview, payload('two'));
    expect(host.close).toHaveBeenCalledWith(expect.objectContaining({ label: 'one.glsl' }), true);
    expect(openPaths()).toContain(file('one.glsl'));
    expect(host.close.mock.calls.some(([tab]) => tab.label === 'notes.txt')).toBe(false);
    host.close.mockClear();
    await manager.update(preview, payload('two'));
    expect(host.close).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('ignores malformed input, missing files and stale work', async () => {
    const manager = new ActiveShaderEditors();
    await manager.setEnabled(true);
    await manager.update({}, { shaderPath: 'relative.glsl', files: [] });
    expect(host.show).not.toHaveBeenCalled();
    const preview = {};
    host.exists.mockImplementation((...args: unknown[]) => !String(args[0]).includes('missing'));
    const old = manager.update(preview, payload('old'));
    await manager.update(preview, payload('new', ['missing.glsl']));
    await old;
    expect(openPaths()).not.toContain(file('old.glsl'));
    expect(openPaths()).not.toContain(file('missing.glsl'));
    await manager.setEnabled(false);
    await manager.update(preview, payload('disabled'));
    expect(openPaths()).not.toContain(file('disabled.glsl'));
    manager.dispose();
    await manager.setEnabled(true);
    expect(openPaths()).not.toContain(file('disabled.glsl'));
  });
});
