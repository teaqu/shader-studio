import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tick } from 'svelte';
import ChannelListItem from '../../../lib/components/config/ChannelListItem.svelte';
import type { ConfigInput } from '@shader-studio/types';

const mockProps = {
  channelName: 'iChannel0',
  channelInput: { type: 'texture', path: 'tex.png' } as ConfigInput,
  getWebviewUri: vi.fn(),
  onEdit: vi.fn(),
  onRemove: vi.fn(),
};

describe('ChannelListItem', () => {
  it('renders channel name', () => {
    const { getByText } = render(ChannelListItem, mockProps);
    expect(getByText('iChannel0')).toBeTruthy();
  });

  it('renders type badge', () => {
    const { container } = render(ChannelListItem, mockProps);
    expect(container.querySelector('.type-badge')?.textContent).toBe('Texture');
  });

  it('calls onEdit when edit button clicked', async () => {
    const onEdit = vi.fn();
    const { container } = render(ChannelListItem, { ...mockProps, onEdit });
    await fireEvent.click(container.querySelector('.edit-btn')!);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('calls onRemove when remove button clicked', async () => {
    const onRemove = vi.fn();
    const { container } = render(ChannelListItem, { ...mockProps, onRemove });
    await fireEvent.click(container.querySelector('.remove-btn')!);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('does not show media controls for texture type', () => {
    const { container } = render(ChannelListItem, mockProps);
    expect(container.querySelector('.media-controls')).toBeNull();
  });

  it('shows media controls for video type when audioVideoController provided', () => {
    const videoProps = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4' } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };
    const { container } = render(ChannelListItem, videoProps);
    expect(container.querySelector('.media-controls')).toBeTruthy();
  });

  it('shows media controls for audio type when audioVideoController provided', () => {
    const audioProps = {
      ...mockProps,
      channelInput: { type: 'audio', path: 'music.mp3' } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn(),
        audioControl: vi.fn(),
        getAudioState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 120 }),
        getAudioFFT: vi.fn(),
      } as any,
    };
    const { container } = render(ChannelListItem, audioProps);
    expect(container.querySelector('.media-controls')).toBeTruthy();
  });

  it('calls onEdit when row body is clicked', async () => {
    const onEdit = vi.fn();
    const { container } = render(ChannelListItem, { ...mockProps, onEdit });
    await fireEvent.click(container.querySelector('.channel-row')!);
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('does not call onEdit when remove button is clicked', async () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const { container } = render(ChannelListItem, { ...mockProps, onEdit, onRemove });
    await fireEvent.click(container.querySelector('.remove-btn')!);
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('ChannelListItem — config-driven mute', () => {
  // Regression: the row's mute button used to toggle off engine-reported
  // mute state and never wrote to config, so a recompile silently discarded
  // the toggle and the icon disagreed with the modal's config-driven icon.
  it('video mute button writes config and applies runtime mute', async () => {
    const onUpdateMuted = vi.fn();
    const videoControl = vi.fn();
    const props = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4' } as ConfigInput,
      onUpdateMuted,
      audioVideoController: {
        videoControl,
        getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { getByTitle } = render(ChannelListItem, props);
    await fireEvent.click(getByTitle('Mute'));

    expect(onUpdateMuted).toHaveBeenCalledWith(true);
    expect(videoControl).toHaveBeenCalledWith('vid.mp4', 'mute');
  });

  it('video mute button icon/title reflects config mute, not engine mute state', () => {
    const props = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4', muted: true } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        // Engine reports unmuted, but config says muted — button must follow config.
        getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { getByTitle, queryByTitle } = render(ChannelListItem, props);
    expect(getByTitle('Unmute')).toBeTruthy();
    expect(queryByTitle('Mute')).toBeNull();
  });

  it('video unmute button writes config false and applies runtime unmute', async () => {
    const onUpdateMuted = vi.fn();
    const videoControl = vi.fn();
    const props = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4', muted: true } as ConfigInput,
      onUpdateMuted,
      audioVideoController: {
        videoControl,
        getVideoState: vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { getByTitle } = render(ChannelListItem, props);
    await fireEvent.click(getByTitle('Unmute'));

    expect(onUpdateMuted).toHaveBeenCalledWith(false);
    expect(videoControl).toHaveBeenCalledWith('vid.mp4', 'unmute');
  });

  it('audio mute button writes config and applies runtime mute', async () => {
    const onUpdateMuted = vi.fn();
    const audioControl = vi.fn();
    const props = {
      ...mockProps,
      channelInput: { type: 'audio', path: 'music.mp3' } as ConfigInput,
      onUpdateMuted,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn(),
        audioControl,
        getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 120 }),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { getByTitle } = render(ChannelListItem, props);
    await fireEvent.click(getByTitle('Mute'));

    expect(onUpdateMuted).toHaveBeenCalledWith(true);
    expect(audioControl).toHaveBeenCalledWith('music.mp3', 'mute');
  });

  it('audio mute button icon/title reflects config mute, not engine mute state', () => {
    const props = {
      ...mockProps,
      channelInput: { type: 'audio', path: 'music.mp3', muted: true } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn(),
        audioControl: vi.fn(),
        getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 120 }),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { getByTitle, queryByTitle } = render(ChannelListItem, props);
    expect(getByTitle('Unmute')).toBeTruthy();
    expect(queryByTitle('Mute')).toBeNull();
  });

  it('does not disable the mute button regardless of engine mute state', () => {
    const props = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4', muted: true } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { getByTitle } = render(ChannelListItem, props);
    const btn = getByTitle('Unmute') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('video preview sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs preview video element play/pause state via audioVideoController', async () => {
    const playSpy = vi.spyOn(HTMLVideoElement.prototype, 'play').mockResolvedValue(undefined);

    const videoProps = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4' } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };

    render(ChannelListItem, videoProps);
    await tick();

    // ChannelPreview must receive audioVideoController so its sync effect
    // calls play() when videoState.paused is false (jsdom video starts paused by default)
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not show overlay controls on the thumbnail', async () => {
    const videoProps = {
      ...mockProps,
      channelInput: { type: 'video', path: 'vid.mp4' } as ConfigInput,
      audioVideoController: {
        videoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 10 }),
        audioControl: vi.fn(),
        getAudioState: vi.fn(),
        getAudioFFT: vi.fn(),
      } as any,
    };

    const { container } = render(ChannelListItem, videoProps);
    await tick();

    // Thumbnail must NOT show ChannelPreview overlay controls — they live in .media-controls
    expect(container.querySelector('.thumbnail .preview-controls')).toBeNull();
  });
});

describe('type badge labels', () => {
  const cases: [ConfigInput, string][] = [
    [{ type: 'video', path: 'v.mp4' } as ConfigInput, 'Video'],
    [{ type: 'audio', path: 'a.mp3' } as ConfigInput, 'Audio'],
    [{ type: 'buffer', source: 'BufferA' } as ConfigInput, 'Buffer'],
    [{ type: 'cubemap', path: 'c.png' } as ConfigInput, 'Cubemap'],
    [{ type: 'keyboard' } as ConfigInput, 'Keyboard'],
  ];

  for (const [input, label] of cases) {
    it(`shows '${label}' badge for ${input.type} type`, () => {
      const { container } = render(ChannelListItem, { ...mockProps, channelInput: input });
      expect(container.querySelector('.type-badge')?.textContent).toBe(label);
    });
  }
});
