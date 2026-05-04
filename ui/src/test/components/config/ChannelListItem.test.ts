import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
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
});
