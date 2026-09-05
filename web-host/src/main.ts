import { mount } from 'svelte';
import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  shaderStudioDefaultAssetRelativePath,
  type WorkspaceFileInfo,
} from '@shader-studio/types';
import { ShaderStudioApp, configureHost } from '@shader-studio/ui';
import ShaderExplorer from '@shader-studio/shader-explorer/lib/components/ShaderExplorer.svelte';
import '@shader-studio/ui/app.css';
import '@vscode/codicons/dist/codicon.css';
import NewShaderModal from './NewShaderModal.svelte';
import { WebTransport } from './WebTransport';

const DOCS_URL = 'https://teaqu.github.io/shader-studio/docs/';

const ALPHA_NOTICE =
  'Web mode is in alpha and is buggy and missing features compared to the VS Code extension.';

function defaultAssets(): WorkspaceFileInfo[] {
  return [
    { name: 'Nebula Texture.png', path: SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture },
    { name: 'Nebula Video.mp4', path: SHADER_STUDIO_DEFAULT_ASSETS.nebulaVideo },
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

configureHost({
  createTransport: () => new WebTransport(),
  explorer: ShaderExplorer,
  newShaderModal: NewShaderModal,
  defaultAssets: defaultAssets(),
  docsUrl: DOCS_URL,
  supportsClearWorkspace: true,
  providesEditingSurface: true,
  notice: ALPHA_NOTICE,
});

const app = mount(ShaderStudioApp, {
  target: document.getElementById('app')!,
});

export default app;
