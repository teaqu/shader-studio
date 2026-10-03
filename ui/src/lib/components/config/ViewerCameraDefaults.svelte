<script lang="ts">
  import type { ShaderConfig } from '@shader-studio/types';
  import type { Transport } from '../../transport/MessageTransport';
  import { persistConfig } from '../../config/ConfigPersistence';
  import { getGlobalViewerCamera } from '../../state/viewerCameraState.svelte';

  interface Props {
    config: ShaderConfig | null;
    transport: Transport;
    shaderPath: string;
    onChange: (config: ShaderConfig) => void;
  }
  let { config, transport, shaderPath, onChange }: Props = $props();

  function changeShader(value: string): void {
    const current = config ?? { version: '1.0', passes: { Image: {} } };
    const { useViewerCamera: _previous, ...preferences } = current.webgpu ?? {};
    const webgpu = value === 'inherit' ? preferences : { ...preferences, useViewerCamera: value === 'on' };
    const updated = { ...current, webgpu };
    onChange(updated);
    persistConfig(transport, { config: updated, shaderPath, skipRefresh: true });
  }
</script>

<details class="camera-defaults">
  <summary>Viewer camera defaults</summary>
  <label>
    This shader
    <select aria-label="Shader viewer camera" value={config?.webgpu?.useViewerCamera === undefined ? 'inherit' : config.webgpu.useViewerCamera ? 'on' : 'off'} onchange={(event) => changeShader(event.currentTarget.value)}>
      <option value="inherit">Use global default</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  </label>
  <label>
    <input type="checkbox" aria-label="Use viewer camera globally" checked={getGlobalViewerCamera()} onchange={(event) => transport.postMessage({ type: 'updateViewerCameraSettings', payload: { useViewerCamera: event.currentTarget.checked } })} />
    Use viewer camera globally
  </label>
  <p>Pass settings override this shader. This shader overrides the global default.</p>
</details>

<style>
  .camera-defaults { margin: 8px; font-size: 12px; }
  summary { cursor: pointer; }
  label { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
  p { color: var(--vscode-descriptionForeground); font-size: 11px; }
</style>
