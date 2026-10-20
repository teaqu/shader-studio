// Must stay first: previews have to isolate storage before anything reads it.
import './installPreviewIsolation';
import { mount } from 'svelte';
import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  type WorkspaceFileInfo,
} from '@shader-studio/types';
import { configureHost } from '@shader-studio/ui';
import '@shader-studio/ui/app.css';
import './themes.css';
import '@vscode/codicons/dist/codicon.css';
import { getEditorPreferences } from './settings/settingsState.svelte';
import App from './App.svelte';
import { WebTransport } from './WebTransport';
import { installSlangAssetMetadata } from './slangAssets';
import { createPwaController } from './pwa';
import { resolveDefaultAssetUrl } from './defaultWorkspace';

function defaultAssets(): WorkspaceFileInfo[] {
  return [
    { name: 'Nebula Texture.png', path: SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture },
    { name: 'Random Greyscale.ktx2', path: SHADER_STUDIO_DEFAULT_ASSETS.noiseGreyVolume },
    { name: 'Random RGBA.ktx2', path: SHADER_STUDIO_DEFAULT_ASSETS.noiseRgbaVolume },
    { name: 'Desert Cubemap.png', path: SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap },
  ].map(({ name, path }) => ({
    name,
    workspacePath: path,
    thumbnailUri: resolveDefaultAssetUrl(path)!,
    isSameDirectory: false,
  }));
}

installSlangAssetMetadata();
const transport = new WebTransport();
const pwa = createPwaController();
configureHost({
  createTransport: () => transport.createViewerTransport(),
  getEditorPreferences,
  setEditorWordWrap: value => {
    transport.settings.update('editor.wordWrap', value);
  },
  setEditorAutoSuggestions: enabled => {
    transport.settings.update('editor.autoSuggestions', enabled);
  },
  setEditorDescriptions: (mobile, enabled) => {
    transport.settings.update(mobile ? 'editor.mobileDescriptions' : 'editor.desktopDescriptions', enabled);
  },
  setEditorMobileNavigation: enabled => {
    transport.settings.update('editor.mobileNavigation', enabled);
  },
  defaultAssets: defaultAssets(),
  uploadAssets: (files, shaderPath) => transport.uploadAssets(files, shaderPath),
  capabilities: { compileOnSave: false },
});

const app = mount(App, {
  target: document.getElementById('app')!,
  props: { transport, pwa },
});
void pwa.start();

export default app;
