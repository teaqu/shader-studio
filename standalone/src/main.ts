import { mount } from 'svelte';
import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  shaderStudioDefaultAssetRelativePath,
  type WorkspaceFileInfo,
} from '@shader-studio/types';
import { configureHost } from '@shader-studio/ui';
import '@shader-studio/ui/app.css';
import '@vscode/codicons/dist/codicon.css';
import App from './App.svelte';
import { WebTransport } from './WebTransport';
import { installSlangAssetMetadata } from './slangAssets';

function defaultAssets(): WorkspaceFileInfo[] {
  return [
    { name: 'Nebula Texture.png', path: SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture },
    { name: 'Desert Cubemap.png', path: SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap },
  ].map(({ name, path }) => ({
    name,
    workspacePath: path,
    thumbnailUri: new URL(
      shaderStudioDefaultAssetRelativePath(path)!,
      document.baseURI,
    ).toString(),
    isSameDirectory: false,
  }));
}

installSlangAssetMetadata();
const transport = new WebTransport();
configureHost({
  createTransport: () => transport,
  defaultAssets: defaultAssets(),
  capabilities: { layoutProfiles: false },
});

const app = mount(App, {
  target: document.getElementById('app')!,
  props: { transport },
});

export default app;
