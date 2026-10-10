import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shaderStarterTemplate } from '@shader-studio/types';
import type { ShaderLanguageId } from '@shader-studio/types';
import { ShaderCreator } from '../../../extension/src/app/ShaderCreator';
import type { Logger } from '../../../extension/src/app/services/Logger';
import type { GlslFileTracker } from '../../../extension/src/app/GlslFileTracker';

const mocks = vi.hoisted(() => ({
  save: vi.fn(), pick: vi.fn(), open: vi.fn(), show: vi.fn(), error: vi.fn(), info: vi.fn(),
  folders: [] as { uri: { fsPath: string } }[],
}));
vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  window: { showSaveDialog: mocks.save, showQuickPick: mocks.pick, showTextDocument: mocks.show,
    showErrorMessage: mocks.error, showInformationMessage: mocks.info },
  workspace: { get workspaceFolders() {
    return mocks.folders;
  },
  getConfiguration: () => ({ get: () => 'hooks' }), openTextDocument: mocks.open },
}));

let directory: string;
const logger = { info: vi.fn(), error: vi.fn() };
const tracker = { getLastViewedGlslFile: vi.fn() };
let creator: ShaderCreator;
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'shader-starter-'));
  mocks.folders = [{ uri: { fsPath: directory } }];
  tracker.getLastViewedGlslFile.mockReturnValue(null);
  mocks.pick.mockResolvedValue({ value: 'hooks' });
  mocks.open.mockResolvedValue({});
  creator = new ShaderCreator(logger as unknown as Logger, tracker as unknown as GlslFileTracker);
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('extension shader starter creation', () => {
  it.each<ShaderLanguageId>(['glsl', 'slang', 'wgsl'])('writes the shared %s starter and opens it', async language => {
    const uri = { fsPath: join(directory, `new.${language}`) };
    mocks.save.mockResolvedValue(uri);
    await creator.create();
    expect(readFileSync(uri.fsPath, 'utf8')).toBe(shaderStarterTemplate(language));
    expect(mocks.open).toHaveBeenCalledWith(uri);
    expect(mocks.show).toHaveBeenCalledWith({}, { preview: false });
    expect(logger.info).toHaveBeenCalled();
  });
  it.each(['slang', 'wgsl'])('preserves native %s creation and its config', async language => {
    const file = join(directory, `new.${language}`);
    mocks.save.mockResolvedValue({ fsPath: file });
    mocks.pick.mockResolvedValue({ value: 'native' });
    await creator.create();
    expect(readFileSync(file, 'utf8')).toContain(language === 'slang' ? '[shader("fragment")]' : '@fragment');
    expect(JSON.parse(readFileSync(join(directory, 'new.sha.json'), 'utf8')).webgpu.defaultRenderAuthoring).toBe('native');
  });
  it('uses the last viewed directory and handles cancellation', async () => {
    tracker.getLastViewedGlslFile.mockReturnValue(join(directory, 'existing.glsl'));
    mocks.save.mockResolvedValue(undefined);
    await creator.create();
    expect(mocks.save.mock.calls[0][0].defaultUri.fsPath).toBe(join(directory, 'shadertoy.glsl'));
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('uses a relative default without a workspace', async () => {
    mocks.folders = []; mocks.save.mockResolvedValue(undefined);
    await creator.create();
    expect(mocks.save.mock.calls[0][0].defaultUri.fsPath).toBe('shadertoy.glsl');
  });
  it('stops when authoring selection is cancelled', async () => {
    mocks.save.mockResolvedValue({ fsPath: join(directory, 'new.wgsl') });
    mocks.pick.mockResolvedValue(undefined);
    await creator.create();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('rejects an existing native config and reports write errors', async () => {
    writeFileSync(join(directory, 'new.sha.json'), '{}');
    mocks.save.mockResolvedValue({ fsPath: join(directory, 'new.wgsl') });
    mocks.pick.mockResolvedValue({ value: 'native' });
    await creator.create();
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('config already exists'));
    mocks.save.mockResolvedValue({ fsPath: join(directory, 'missing', 'new.glsl') });
    await creator.create();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to create'));
  });
});
