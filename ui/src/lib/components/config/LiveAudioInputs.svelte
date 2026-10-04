<script lang="ts">
  import type { ConfigInput } from '@shader-studio/types';
  import type { AudioVideoController } from '../../AudioVideoController';
  import { isVSCodeEnvironment } from '../../transport/TransportFactory';
  import { tooltip } from '../../actions/tooltip';
  import ChannelPreview from './ChannelPreview.svelte';
  import SystemAudioControls from './SystemAudioControls.svelte';

  interface Props {
    input?: ConfigInput;
    audioVideoController?: AudioVideoController;
    getWebviewUri: (path: string) => string | undefined;
    onSelect: (input: ConfigInput) => void;
  }
  let { input, audioVideoController, getWebviewUri, onSelect }: Props = $props();
  const captureUnavailable = isVSCodeEnvironment();
</script>

<div class="live-audio-options">
  {#each [{ type: 'microphone', label: 'Mic' }, { type: 'system-audio', label: 'Shared Audio' }] as option}
    <button class:selected={input?.type === option.type} aria-label={option.label}
      aria-disabled={captureUnavailable}
      use:tooltip={captureUnavailable ? `${option.label} is unavailable in VS Code. Open Shader Studio in a browser to use this input.` : ''}
      onclick={() => {
 if (!captureUnavailable) {
onSelect({ type: option.type as 'microphone' | 'system-audio' });
} 
}}>
      <ChannelPreview channelInput={{ type: option.type as 'microphone' | 'system-audio' }} {getWebviewUri} {audioVideoController} />
      <span>{option.label}</span>
    </button>
  {/each}
</div>
{#if !captureUnavailable && (input?.type === 'microphone' || input?.type === 'system-audio')}
  <SystemAudioControls type={input.type} {audioVideoController} />
{/if}

<style>
  .live-audio-options { display: flex; gap: 8px; margin-bottom: 12px; }
  .live-audio-options button { display: flex; flex-direction: column; width: 96px; padding: 0; overflow: hidden; border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 6px; background: var(--vscode-editor-background, #1e1e1e); cursor: pointer; }
  .live-audio-options button.selected { border-color: var(--vscode-focusBorder, #007acc); }
  .live-audio-options span { padding: 6px 4px; font-size: 11px; width: 100%; text-align: center; color: var(--vscode-foreground, #ccc); }
  .live-audio-options button[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
</style>
