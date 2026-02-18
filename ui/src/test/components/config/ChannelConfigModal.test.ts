import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChannelConfigModal from '../../../lib/components/config/ChannelConfigModal.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('ChannelConfigModal', () => {
  let mockGetWebviewUri: (path: string) => string | undefined;
  let mockOnClose: ReturnType<typeof vi.fn>;
  let mockOnSave: ReturnType<typeof vi.fn>;
  let mockOnRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetWebviewUri = vi.fn((path: string) => `webview://path/${path}`);
    mockOnClose = vi.fn();
    mockOnSave = vi.fn();
    mockOnRemove = vi.fn();
    vi.clearAllMocks();
  });

  describe('Modal Display', () => {
    it('should not render when isOpen is false', () => {
      const { container } = render(ChannelConfigModal, {
        isOpen: false,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      expect(container.querySelector('.modal-overlay')).toBeFalsy();
    });

    it('should render modal when isOpen is true', () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      expect(screen.getByText('Configure iChannel0')).toBeInTheDocument();
      expect(screen.getByLabelText('Type:')).toBeInTheDocument();
    });

    it('should display modal as overlay with proper z-index', () => {
      const { container } = render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const overlay = container.querySelector('.modal-overlay');
      expect(overlay).toBeTruthy();

      // Check that it has fixed positioning styles (will be in computed styles)
      const modalContent = container.querySelector('.modal-content');
      expect(modalContent).toBeTruthy();
    });
  });

  describe('Modal Closing', () => {
    it('should call onClose when Close button is clicked', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const closeButton = screen.getByText('Close');
      await fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Escape key is pressed', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      await fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when clicking modal backdrop', async () => {
      const { container } = render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const overlay = container.querySelector('.modal-overlay');
      await fireEvent.click(overlay!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should not close when clicking modal content', async () => {
      const { container } = render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const modalContent = container.querySelector('.modal-content');
      await fireEvent.click(modalContent!);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Auto-Save on Type Selection', () => {
    it('should auto-save when selecting buffer type', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'buffer' } });

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', {
        type: 'buffer',
        source: 'BufferA'
      });
    });

    it('should auto-save when selecting texture type', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel1',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'texture' } });

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel1', {
        type: 'texture',
        path: ''
      });
    });

    it('should auto-save when selecting video type', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel2',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'video' } });

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel2', {
        type: 'video',
        path: ''
      });
    });

    it('should auto-save when selecting keyboard type', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel3',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'keyboard' } });

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel3', {
        type: 'keyboard'
      });
    });
  });

  describe('Buffer Configuration Auto-Save', () => {
    it('should auto-save when changing buffer source', async () => {
      const bufferInput: ConfigInput = {
        type: 'buffer',
        source: 'BufferA'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: bufferInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const sourceSelect = screen.getByLabelText('Source:') as HTMLSelectElement;
      await fireEvent.change(sourceSelect, { target: { value: 'BufferB' } });

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', {
        type: 'buffer',
        source: 'BufferB'
      });
    });
  });

  describe('Texture Configuration Auto-Save', () => {
    it('should auto-save when changing texture path', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: ''
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './texture.png' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        type: 'texture',
        path: './texture.png'
      }));
    });

    it('should auto-save when changing filter setting', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './texture.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        filter: 'nearest'
      }));
    });

    it('should auto-save when changing wrap setting', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './texture.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'clamp' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        wrap: 'clamp'
      }));
    });

    it('should auto-save when toggling vertical flip', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './texture.png',
        vflip: true
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      await fireEvent.click(vflipCheckbox);

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        vflip: false
      }));
    });

    it('should auto-save when toggling grayscale', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './texture.png',
        grayscale: false
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const grayscaleCheckbox = screen.getByLabelText('Grayscale') as HTMLInputElement;
      await fireEvent.click(grayscaleCheckbox);

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        grayscale: true
      }));
    });
  });

  describe('Video Configuration Auto-Save', () => {
    it('should auto-save when changing video path', async () => {
      const videoInput: ConfigInput = {
        type: 'video',
        path: ''
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: videoInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './video.mp4' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        type: 'video',
        path: './video.mp4'
      }));
    });

    it('should auto-save when changing video filter', async () => {
      const videoInput: ConfigInput = {
        type: 'video',
        path: './video.mp4'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: videoInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        filter: 'nearest'
      }));
    });
  });

  describe('Remove Functionality', () => {
    it('should show Remove button when channel has existing input', () => {
      const existingInput: ConfigInput = {
        type: 'texture',
        path: './texture.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: existingInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('should not show Remove button when channel has no input', () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    });

    it('should call onRemove when Remove button is clicked', async () => {
      const existingInput: ConfigInput = {
        type: 'texture',
        path: './texture.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: existingInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const removeButton = screen.getByText('Remove');
      await fireEvent.click(removeButton);

      expect(mockOnRemove).toHaveBeenCalledTimes(1);
      expect(mockOnRemove).toHaveBeenCalledWith('iChannel0');
    });
  });

  describe('Keyboard Input Display', () => {
    it('should display keyboard info when keyboard type is selected', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'keyboard' } });

      // Wait for the keyboard input note to appear
      const keyboardNote = await screen.findByText(/Keyboard input provides/i);
      expect(keyboardNote).toBeInTheDocument();
    });
  });

  describe('Initial State', () => {
    it('should initialize with existing texture input', () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './existing.png',
        filter: 'linear',
        wrap: 'clamp'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      expect(typeSelect.value).toBe('texture');

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./existing.png');
    });

    it('should initialize with existing buffer input', () => {
      const bufferInput: ConfigInput = {
        type: 'buffer',
        source: 'BufferC'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: bufferInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      expect(typeSelect.value).toBe('buffer');

      const sourceSelect = screen.getByLabelText('Source:') as HTMLSelectElement;
      expect(sourceSelect.value).toBe('BufferC');
    });
  });

  describe('Path Display', () => {
    it('should display the original path as-is without transformation', () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'test.jpg'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // The path input should show the original path exactly as provided
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('test.jpg');
    });

    it('should extract original path from webview URI when updating path', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // Simulate pasting a webview URI into the path input
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      const webviewUri = 'https://file%2B.vscode-resource.vscode-cdn.net/Users/calum/test.jpg';
      await fireEvent.input(pathInput, { target: { value: webviewUri } });

      // onSave should be called with the extracted original path, not the webview URI
      expect(mockOnSave).toHaveBeenCalled();
      const savedInput = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1][1];
      expect(savedInput.type).toBe('texture');
      expect(savedInput.path).not.toContain('vscode-resource');
      expect(savedInput.path).toContain('/Users/calum/test.jpg');
    });

    it('should preserve normal paths without modification', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // Select texture type
      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'texture' } });

      // Verify that texture type was selected and saved
      expect(mockOnSave).toHaveBeenCalled();
      const textureTypeCall = mockOnSave.mock.calls.find(call => call[1].type === 'texture');
      expect(textureTypeCall).toBeTruthy();
      expect(textureTypeCall![1]).toEqual({ type: 'texture', path: '' });

      // Wait for texture-specific Path input to appear
      const pathInput = await screen.findByLabelText('Path:', {}, { timeout: 2000 }) as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './normal/path.jpg' } });

      // The path should be saved as-is
      const savedInput = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1][1];
      expect(savedInput.path).toBe('./normal/path.jpg');
    });
  });

  describe('Path Change Clears Resolved Path', () => {
    it('should clear resolved_path when path is changed so preview updates', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'old-texture.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: { ...textureInput, resolved_path: 'https://webview-uri/old-texture.png' } as any,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // User types a new path
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: 'new-texture.png' } });

      // The saved input should NOT carry the old resolved_path
      expect(mockOnSave).toHaveBeenCalled();
      const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      const savedInput = lastCall[1];
      expect(savedInput.path).toBe('new-texture.png');
      expect(savedInput.resolved_path).toBeUndefined();
    });
  });

  describe('Resolved Path Merging', () => {
    it('should merge resolved_path from parent into tempInput without resetting edits', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'canvas.png'
      };

      const defaultProps = {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      };

      const { rerender } = render(ChannelConfigModal, defaultProps);

      // Verify initial path displayed
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('canvas.png');

      // Simulate parent updating channelInput with resolved_path (round-trip from extension)
      const updatedInput: any = {
        type: 'texture',
        path: 'canvas.png',
        resolved_path: 'https://webview-uri/canvas.png'
      };
      await rerender({ ...defaultProps, channelInput: updatedInput });

      // Path input should still show original path
      expect(pathInput.value).toBe('canvas.png');
    });

    it('should not re-apply old resolved_path when user changes path', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'paw.jpg'
      };

      const defaultProps = {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: { ...textureInput, resolved_path: 'https://webview-uri/paw.jpg' } as any,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      };

      const { rerender } = render(ChannelConfigModal, defaultProps);

      // User types a different path (e.g. a typo)
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: 'paw.jpgf' } });

      // The saved input should have the new path and no resolved_path
      expect(mockOnSave).toHaveBeenCalled();
      const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      const savedInput = lastCall[1];
      expect(savedInput.path).toBe('paw.jpgf');
      expect(savedInput.resolved_path).toBeUndefined();

      // Simulate parent re-rendering with old resolved_path (from old config round-trip)
      // The parent still has 'paw.jpg' with its resolved_path
      await rerender({ ...defaultProps });

      // The old resolved_path should NOT be merged because paths don't match
      // Verify by checking the last save - path should still be 'paw.jpgf'
      const latestCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      expect(latestCall[1].path).toBe('paw.jpgf');
      // resolved_path should not have been re-applied
      expect(latestCall[1].resolved_path).toBeUndefined();
    });

    it('should not reset user edits when resolved_path arrives', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'original.png',
        filter: 'linear'
      };

      const defaultProps = {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      };

      const { rerender } = render(ChannelConfigModal, defaultProps);

      // User changes filter
      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      // Parent sends back resolved_path
      const updatedInput: any = {
        type: 'texture',
        path: 'original.png',
        resolved_path: 'https://webview-uri/original.png'
      };
      await rerender({ ...defaultProps, channelInput: updatedInput });

      // The auto-save should have captured the filter change
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        filter: 'nearest'
      }));
    });
  });

  describe('Modal Stays Open During Edits', () => {
    it('should not call onClose when auto-saving changes', async () => {
      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // Select texture type
      const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
      await fireEvent.change(typeSelect, { target: { value: 'texture' } });

      // Auto-save should be called, but not onClose
      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should allow multiple consecutive edits without closing', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // Make multiple changes
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './texture1.png' } });
      await fireEvent.input(pathInput, { target: { value: './texture2.png' } });

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'clamp' } });

      // onSave should be called multiple times, but onClose should never be called
      expect(mockOnSave.mock.calls.length).toBeGreaterThan(1);
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should only close when Close button is clicked', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        isOpen: true,
        channelName: 'iChannel0',
        channelInput: textureInput,
        getWebviewUri: mockGetWebviewUri,
        onClose: mockOnClose,
        onSave: mockOnSave,
        onRemove: mockOnRemove
      });

      // Make some changes
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './new.png' } });

      expect(mockOnClose).not.toHaveBeenCalled();

      // Click Close button
      const closeButton = screen.getByText('Close');
      await fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });
});
