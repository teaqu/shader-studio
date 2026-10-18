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
  function selectLiveAudio(type: 'microphone' | 'system-audio') {
    if (!captureUnavailable) {
      onSelect({ type });
    }
  }
</script>

<div class="live-audio-options">
  {#each [{ type: 'microphone', label: 'Mic' }, { type: 'system-audio', label: 'Shared Audio' }] as option}
    <button class:selected={input?.type === option.type} aria-label={option.label}
      aria-disabled={captureUnavailable}
      use:tooltip={captureUnavailable ? `${option.label} is unavailable in VS Code. Open Shader Studio in a browser to use this input.` : ''}
      onclick={() => selectLiveAudio(option.type as 'microphone' | 'system-audio')}>
      <ChannelPreview channelInput={{ type: option.type as 'microphone' | 'system-audio' }} {getWebviewUri} {audioVideoController} showLiveLabel={false} />
      <span>{option.label}</span>
    </button>
  {/each}
</div>
{#if !captureUnavailable && (input?.type === 'microphone' || input?.type === 'system-audio')}
  <SystemAudioControls type={input.type} {audioVideoController} />
{/if}

<style>
  .live-audio-options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .live-audio-options button { display: flex; align-items: center; gap: 8px; padding: 8px 12px; overflow: hidden; border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: var(--shader-studio-control-radius); background: var(--vscode-editor-background, #1e1e1e); cursor: pointer; min-height: 44px; color: var(--vscode-foreground); }
  .live-audio-options button:hover { background: var(--vscode-list-hoverBackground); }
  .live-audio-options button.selected { border-color: var(--shader-studio-selected-border); background: var(--shader-studio-selected-background); color: var(--shader-studio-selected-foreground); }
  .live-audio-options span { font-size: var(--shader-studio-font-size); }
  .live-audio-options :global(.channel-preview-container) { width: 24px; height: 24px; flex: 0 0 24px; aspect-ratio: auto; border-radius: 3px; background: transparent; }
  .live-audio-options button[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
</style>
