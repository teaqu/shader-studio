<svelte:options runes={true} />

<script lang="ts">
  import type { ConfigInput } from '@shader-studio/types';
  import type { AudioVideoController } from '../../AudioVideoController';
  import ChannelPreview from './ChannelPreview.svelte';

  interface Props {
    channelName: string;
    channelInput: ConfigInput;
    getWebviewUri: (path: string) => string | undefined;
    audioVideoController?: AudioVideoController;
    globalMuted?: boolean;
    onEdit: () => void;
    onRemove: () => void;
  }

  let {
    channelName,
    channelInput,
    getWebviewUri,
    audioVideoController = undefined,
    globalMuted = false,
    onEdit,
    onRemove,
  }: Props = $props();

  function typeBadgeLabel(input: ConfigInput): string {
    switch (input.type) {
      case 'texture': return 'Texture';
      case 'video': return 'Video';
      case 'audio': return 'Audio';
      case 'buffer': return 'Buffer';
      case 'cubemap': return 'Cubemap';
      case 'keyboard': return 'Keyboard';
      default: return input.type;
    }
  }

  const hasMediaControls = $derived(
    (channelInput.type === 'video' || channelInput.type === 'audio') && !!audioVideoController
  );

  const onVideoControl = $derived(audioVideoController
    ? (p: string, a: string) => audioVideoController!.videoControl(p, a)
    : undefined);
  const getVideoState = $derived(audioVideoController
    ? (p: string) => audioVideoController!.getVideoState(p)
    : undefined);
  const onAudioControl = $derived(audioVideoController
    ? (p: string, a: string) => audioVideoController!.audioControl(p, a)
    : undefined);
  const getAudioState = $derived(audioVideoController
    ? (p: string) => audioVideoController!.getAudioState(p)
    : undefined);

  let videoState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = $state(null);
  let audioState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = $state(null);

  $effect(() => {
    const type = channelInput.type;
    const resolvedPath = (channelInput as any).resolved_path || ('path' in channelInput ? (channelInput as any).path : undefined);
    const gvs = getVideoState;
    if (type === 'video' && resolvedPath && gvs) {
      videoState = gvs(resolvedPath);
      const id = setInterval(() => {
        videoState = gvs(resolvedPath); 
      }, 500);
      return () => clearInterval(id);
    } else {
      videoState = null;
    }
  });

  $effect(() => {
    const type = channelInput.type;
    const resolvedPath = (channelInput as any).resolved_path || ('path' in channelInput ? (channelInput as any).path : undefined);
    const gas = getAudioState;
    if (type === 'audio' && resolvedPath && gas) {
      audioState = gas(resolvedPath);
      const id = setInterval(() => {
        audioState = gas(resolvedPath); 
      }, 500);
      return () => clearInterval(id);
    } else {
      audioState = null;
    }
  });

  function videoControl(action: string, e: MouseEvent) {
    e.stopPropagation();
    const path = (channelInput as any).resolved_path || (channelInput as any).path;
    onVideoControl?.(path, action);
    setTimeout(() => {
      if (getVideoState) {
        videoState = getVideoState(path);
      } 
    }, 100);
  }

  function audioControl(action: string, e: MouseEvent) {
    e.stopPropagation();
    const path = (channelInput as any).resolved_path || (channelInput as any).path;
    onAudioControl?.(path, action);
    setTimeout(() => {
      if (getAudioState) {
        audioState = getAudioState(path);
      } 
    }, 100);
  }
</script>

<div
  class="channel-row"
  onclick={onEdit}
  onkeydown={(e) => e.key === 'Enter' && onEdit()}
  role="button"
  tabindex="0"
>
  <div class="thumbnail">
    <!-- No audioVideoController passed: suppresses overlay controls on the thumbnail -->
    <ChannelPreview {channelInput} {getWebviewUri} />
  </div>

  <div class="row-info">
    <span class="channel-name">{channelName}</span>
    <span class="type-badge">{typeBadgeLabel(channelInput)}</span>
  </div>

  {#if hasMediaControls}
    <div class="media-controls" role="presentation" onclick={(e) => e.stopPropagation()}>
      {#if channelInput.type === 'video'}
        <button
          class="ctrl-btn"
          onclick={(e) => videoControl(videoState?.paused ? 'play' : 'pause', e)}
          title={videoState?.paused ? 'Play' : 'Pause'}
        >
          {#if videoState?.paused}
            <i class="codicon codicon-play"></i>
          {:else}
            <i class="codicon codicon-debug-pause"></i>
          {/if}
        </button>
        <button
          class="ctrl-btn"
          onclick={(e) => videoControl(videoState?.muted ? 'unmute' : 'mute', e)}
          title={videoState?.muted ? 'Unmute' : 'Mute'}
          disabled={videoState?.muted && globalMuted}
        >
          {#if videoState?.muted}
            <i class="codicon codicon-mute"></i>
          {:else}
            <i class="codicon codicon-unmute"></i>
          {/if}
        </button>
        <button
          class="ctrl-btn"
          onclick={(e) => videoControl('reset', e)}
          title="Reset to beginning"
          aria-label="Reset video to beginning"
        >
          <i class="codicon codicon-debug-restart"></i>
        </button>
      {:else if channelInput.type === 'audio'}
        <button
          class="ctrl-btn"
          onclick={(e) => audioControl(audioState?.paused ? 'play' : 'pause', e)}
          title={audioState?.paused ? 'Play' : 'Pause'}
        >
          {#if audioState?.paused}
            <i class="codicon codicon-play"></i>
          {:else}
            <i class="codicon codicon-debug-pause"></i>
          {/if}
        </button>
        <button
          class="ctrl-btn"
          onclick={(e) => audioControl(audioState?.muted ? 'unmute' : 'mute', e)}
          title={audioState?.muted ? 'Unmute' : 'Mute'}
          disabled={audioState?.muted && globalMuted}
        >
          {#if audioState?.muted}
            <i class="codicon codicon-mute"></i>
          {:else}
            <i class="codicon codicon-unmute"></i>
          {/if}
        </button>
        <button
          class="ctrl-btn"
          onclick={(e) => audioControl('reset', e)}
          title="Reset to beginning"
          aria-label="Reset audio to beginning"
        >
          <i class="codicon codicon-debug-restart"></i>
        </button>
      {/if}
    </div>
  {/if}

  <div class="row-actions" role="presentation" onclick={(e) => e.stopPropagation()}>
    <button class="edit-btn" onclick={onEdit} title="Configure channel" aria-label="Configure {channelName}">
      <i class="codicon codicon-settings-gear"></i>
    </button>
    <button class="remove-btn" onclick={onRemove} title="Remove channel" aria-label="Remove {channelName}">
      <i class="codicon codicon-trash"></i>
    </button>
  </div>
</div>

<style>
  .channel-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editor-background);
    cursor: pointer;
    transition: background 0.15s;
  }

  .channel-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
  }

  .channel-row:focus {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: -1px;
  }

  .thumbnail {
    width: 64px;
    height: 48px;
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .channel-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .type-badge {
    font-size: 10px;
    color: var(--vscode-descriptionForeground, #888);
    background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    padding: 1px 6px;
    border-radius: 10px;
    width: fit-content;
  }

  .media-controls {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .ctrl-btn {
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-foreground, #cccccc);
    cursor: pointer;
    font-size: 12px;
    padding: 3px 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    transition: background 0.15s;
  }

  .ctrl-btn:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.1));
  }

  .ctrl-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .row-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .channel-row:hover .row-actions {
    opacity: 1;
  }

  .edit-btn,
  .remove-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    font-size: 13px;
    padding: 3px 5px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: color 0.15s, background 0.15s;
  }

  .edit-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.1));
  }

  .remove-btn:hover {
    color: var(--vscode-errorForeground, #f48771);
    background: rgba(244, 135, 113, 0.1);
  }
</style>
