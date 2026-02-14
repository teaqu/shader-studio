import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ChannelPreview from '../lib/components/ChannelPreview.svelte';
import ChannelConfigModal from '../lib/components/ChannelConfigModal.svelte';

describe('Channel Modal Components - Smoke Tests', () => {
  it('should render ChannelPreview for empty channel', () => {
    const { container } = render(ChannelPreview, {
      props: {
        channelInput: undefined,
        getWebviewUri: () => undefined
      }
    });

    expect(container.querySelector('.empty-preview')).toBeInTheDocument();
    expect(container.querySelector('.empty-icon')).toHaveTextContent('+');
  });

  it('should render ChannelPreview for texture', () => {
    const { container } = render(ChannelPreview, {
      props: {
        channelInput: {
          type: 'texture',
          path: './test.png'
        },
        getWebviewUri: (path: string) => `vscode-webview://test/${path}`
      }
    });

    expect(container.querySelector('.texture-preview')).toBeInTheDocument();
  });

  it('should render ChannelPreview for buffer', () => {
    const { container } = render(ChannelPreview, {
      props: {
        channelInput: {
          type: 'buffer',
          source: 'BufferA'
        },
        getWebviewUri: () => undefined
      }
    });

    expect(container.querySelector('.buffer-preview')).toBeInTheDocument();
    expect(screen.getByText('BufferA')).toBeInTheDocument();
  });

  it('should render ChannelPreview for keyboard', () => {
    const { container } = render(ChannelPreview, {
      props: {
        channelInput: {
          type: 'keyboard'
        },
        getWebviewUri: () => undefined
      }
    });

    expect(container.querySelector('.keyboard-preview')).toBeInTheDocument();
  });

  it('should render ChannelPreview for video', () => {
    const { container } = render(ChannelPreview, {
      props: {
        channelInput: {
          type: 'video',
          path: './test.mp4'
        },
        getWebviewUri: () => undefined
      }
    });

    expect(container.querySelector('.video-preview')).toBeInTheDocument();
  });

  it('should render closed ChannelConfigModal', () => {
    const { container } = render(ChannelConfigModal, {
      props: {
        isOpen: false,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: () => undefined,
        onClose: () => {},
        onSave: () => {},
        onRemove: () => {}
      }
    });

    expect(container.querySelector('.modal-overlay')).not.toBeInTheDocument();
  });

  it('should render open ChannelConfigModal', () => {
    render(ChannelConfigModal, {
      props: {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: () => undefined,
        onClose: () => {},
        onSave: () => {},
        onRemove: () => {}
      }
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Configure iChannel0')).toBeInTheDocument();
    expect(screen.getByText('-- Select Type --')).toBeInTheDocument();
  });

  it('should render modal with texture configuration', () => {
    render(ChannelConfigModal, {
      props: {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: {
          type: 'texture',
          path: './test.png',
          filter: 'mipmap',
          wrap: 'repeat'
        },
        getWebviewUri: () => undefined,
        onClose: () => {},
        onSave: () => {},
        onRemove: () => {}
      }
    });

    expect(screen.getByLabelText('Type:')).toHaveValue('texture');
    expect(screen.getByLabelText('Filter:')).toHaveValue('mipmap');
    expect(screen.getByLabelText('Wrap:')).toHaveValue('repeat');
  });
});
