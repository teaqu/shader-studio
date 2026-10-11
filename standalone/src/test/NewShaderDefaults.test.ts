import { expect, it, vi } from 'vitest';
import { WebExtensionHost } from '../WebExtensionHost';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { StandaloneSettings } from '../settings/StandaloneSettings';

it.each(['wgsl', 'slang', 'glsl'])('uses the global default for new %s shaders and preserves explicit Built-in selection', async language => {
  const workspace = await VirtualWorkspace.open(new MemoryWorkspaceStore(), []);
  const settings = new StandaloneSettings({ getItem: () => null, setItem: vi.fn() });
  settings.update('webgpu.defaultRenderAuthoring', 'native');
  const host = new WebExtensionHost(workspace, { settings });
  await host.handleViewerMessage({ type: 'createShader', payload: { name: 'native-default', language } });
  const source = workspace.readText(`/shaders/native-default.${language}`);
  expect(source).toContain(language === 'glsl' ? 'mainImage' : 'ImageFragment');
  expect(source).not.toContain('ImageVertex');
  const config = JSON.parse(workspace.readText('/shaders/native-default.sha.json'));
  if (language !== 'glsl') {
    expect(config.passes.Image.entryPoints).toEqual({ fragment: 'ImageFragment' });
  }
  await host.handleViewerMessage({ type: 'createShader', payload: { name: 'explicit-hooks', language, authoringMode: 'hooks' } });
  expect(workspace.readText(`/shaders/explicit-hooks.${language}`)).toContain('mainImage');
  host.dispose();
});
