import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChannelConfigModal from '../../../lib/components/config/ChannelConfigModal.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('ChannelConfigModal', () => {
  let mockGetWebviewUri: (path: string) => string | undefined;
  let mockOnClose: ReturnType<typeof vi.fn>;
  let mockOnSave: ReturnType<typeof vi.fn>;
  let mockOnRemove: ReturnType<typeof vi.fn>;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetWebviewUri = vi.fn((path: string) => `webview://path/${path}`);
    mockOnClose = vi.fn();
    mockOnSave = vi.fn();
    mockOnRemove = vi.fn();
    mockPostMessage = vi.fn();
    vi.clearAllMocks();
  });

  const defaultProps = () => ({
    isOpen: true,
    channelName: 'iChannel0',
    channelInput: undefined as ConfigInput | undefined,
    getWebviewUri: mockGetWebviewUri,
    onClose: mockOnClose,
    onSave: mockOnSave,
    onRemove: mockOnRemove,
    postMessage: mockPostMessage,
    shaderPath: '/test/shader.glsl',
  });

  describe('Modal Display', () => {
    it('should not render when isOpen is false', () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        isOpen: false,
      });

      expect(container.querySelector('.modal-overlay')).toBeFalsy();
    });

    it('should render modal when isOpen is true', () => {
      render(ChannelConfigModal, defaultProps());

      expect(screen.getByText('Configure iChannel0')).toBeInTheDocument();
    });

    it('should display tab bar with all tabs', () => {
      render(ChannelConfigModal, defaultProps());

      expect(screen.getByRole('tab', { name: 'Misc' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Textures' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Cubemaps' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Volumes' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Videos' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Music' })).toBeInTheDocument();
    });

    it('should show prompt when no tab is active', () => {
      render(ChannelConfigModal, defaultProps());

      expect(screen.getByText(/Select a category/)).toBeInTheDocument();
    });

    it('should display modal as overlay', () => {
      const { container } = render(ChannelConfigModal, defaultProps());

      const overlay = container.querySelector('.modal-overlay');
      expect(overlay).toBeTruthy();
      const modalContent = container.querySelector('.modal-content');
      expect(modalContent).toBeTruthy();
    });
  });

  describe('Modal Closing', () => {
    it('should call onClose when Close button is clicked', async () => {
      render(ChannelConfigModal, defaultProps());

      const closeButton = screen.getByText('Close');
      await fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Escape key is pressed', async () => {
      render(ChannelConfigModal, defaultProps());

      await fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when clicking modal backdrop', async () => {
      const { container } = render(ChannelConfigModal, defaultProps());

      const overlay = container.querySelector('.modal-overlay');
      await fireEvent.click(overlay!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should not close when clicking modal content', async () => {
      const { container } = render(ChannelConfigModal, defaultProps());

      const modalContent = container.querySelector('.modal-content');
      await fireEvent.click(modalContent!);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Tab Selection and Auto-Save', () => {
    it('should auto-save when clicking Misc tab and selecting buffer', async () => {
      render(ChannelConfigModal, defaultProps());

      const miscTab = screen.getByRole('tab', { name: 'Misc' });
      await fireEvent.click(miscTab);

      // Clicking Misc defaults to buffer
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', {
        type: 'buffer',
        source: 'BufferA'
      });
    });

    it('should auto-save when clicking Textures tab', async () => {
      render(ChannelConfigModal, defaultProps());

      const texturesTab = screen.getByRole('tab', { name: 'Textures' });
      await fireEvent.click(texturesTab);

      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', {
        type: 'texture',
        path: ''
      });
    });

    it('should auto-save when clicking Videos tab', async () => {
      render(ChannelConfigModal, {
        ...defaultProps(),
        channelName: 'iChannel2',
      });

      const videosTab = screen.getByRole('tab', { name: 'Videos' });
      await fireEvent.click(videosTab);

      expect(mockOnSave).toHaveBeenCalledWith('iChannel2', {
        type: 'video',
        path: ''
      });
    });

    it('should auto-save when selecting keyboard from Misc tab', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelName: 'iChannel3',
      });

      // Click Misc tab first
      const miscTab = screen.getByRole('tab', { name: 'Misc' });
      await fireEvent.click(miscTab);

      // Click keyboard card — use the .misc-card-label to find the right button
      const labels = container.querySelectorAll('.misc-card-label');
      const keyboardLabel = Array.from(labels).find(el => el.textContent === 'Keyboard');
      const keyboardButton = keyboardLabel?.closest('button');
      await fireEvent.click(keyboardButton!);

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

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: bufferInput,
      });

      // Misc tab should be active with buffer cards
      // Click BufferB card — use .misc-card-label to find the right button
      const labels = container.querySelectorAll('.misc-card-label');
      const bufferBLabel = Array.from(labels).find(el => el.textContent === 'BufferB');
      const bufferBButton = bufferBLabel?.closest('button');
      await fireEvent.click(bufferBButton!);

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
        ...defaultProps(),
        channelInput: textureInput,
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
        ...defaultProps(),
        channelInput: textureInput,
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
        ...defaultProps(),
        channelInput: textureInput,
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
        ...defaultProps(),
        channelInput: textureInput,
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
        ...defaultProps(),
        channelInput: textureInput,
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
        ...defaultProps(),
        channelInput: videoInput,
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
        ...defaultProps(),
        channelInput: videoInput,
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
        ...defaultProps(),
        channelInput: existingInput,
      });

      expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('should not show Remove button when channel has no input', () => {
      render(ChannelConfigModal, defaultProps());

      expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    });

    it('should call onRemove when Remove button is clicked', async () => {
      const existingInput: ConfigInput = {
        type: 'texture',
        path: './texture.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: existingInput,
      });

      const removeButton = screen.getByText('Remove');
      await fireEvent.click(removeButton);

      expect(mockOnRemove).toHaveBeenCalledTimes(1);
      expect(mockOnRemove).toHaveBeenCalledWith('iChannel0');
    });
  });

  describe('Initial State', () => {
    it('should initialize with existing texture input and Textures tab active', () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './existing.png',
        filter: 'linear',
        wrap: 'clamp'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: textureInput,
      });

      // Textures tab should be active
      const texturesTab = screen.getByRole('tab', { name: 'Textures' });
      expect(texturesTab.getAttribute('aria-selected')).toBe('true');

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./existing.png');
    });

    it('should initialize with existing buffer input and Misc tab active', () => {
      const bufferInput: ConfigInput = {
        type: 'buffer',
        source: 'BufferC'
      };

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: bufferInput,
      });

      // Misc tab should be active
      const miscTab = screen.getByRole('tab', { name: 'Misc' });
      expect(miscTab.getAttribute('aria-selected')).toBe('true');

      // BufferC card should be selected — use .misc-card-label to find the right button
      const labels = container.querySelectorAll('.misc-card-label');
      const bufferCLabel = Array.from(labels).find(el => el.textContent === 'BufferC');
      const bufferCButton = bufferCLabel?.closest('button');
      expect(bufferCButton?.classList.contains('selected')).toBe(true);
    });

    it('should initialize with existing video input and Videos tab active', () => {
      const videoInput: ConfigInput = {
        type: 'video',
        path: './test.mp4'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: videoInput,
      });

      const videosTab = screen.getByRole('tab', { name: 'Videos' });
      expect(videosTab.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('Path Display', () => {
    it('should display the original path as-is without transformation', () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'test.jpg'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: textureInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('test.jpg');
    });

    it('should extract original path from webview URI when updating path', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: textureInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      const webviewUri = 'https://file%2B.vscode-resource.vscode-cdn.net/Users/calum/test.jpg';
      await fireEvent.input(pathInput, { target: { value: webviewUri } });

      expect(mockOnSave).toHaveBeenCalled();
      const savedInput = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1][1];
      expect(savedInput.type).toBe('texture');
      expect(savedInput.path).not.toContain('vscode-resource');
      expect(savedInput.path).toContain('/Users/calum/test.jpg');
    });

    it('should preserve normal paths without modification', async () => {
      render(ChannelConfigModal, defaultProps());

      // Click Textures tab
      const texturesTab = screen.getByRole('tab', { name: 'Textures' });
      await fireEvent.click(texturesTab);

      expect(mockOnSave).toHaveBeenCalled();
      const textureTypeCall = mockOnSave.mock.calls.find((call: any) => call[1].type === 'texture');
      expect(textureTypeCall).toBeTruthy();
      expect(textureTypeCall![1]).toEqual({ type: 'texture', path: '' });

      const pathInput = await screen.findByLabelText('Path:', {}, { timeout: 2000 }) as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './normal/path.jpg' } });

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
        ...defaultProps(),
        channelInput: { ...textureInput, resolved_path: 'https://webview-uri/old-texture.png' } as any,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: 'new-texture.png' } });

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

      const props = {
        ...defaultProps(),
        channelInput: textureInput,
      };

      const { rerender } = render(ChannelConfigModal, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('canvas.png');

      const updatedInput: any = {
        type: 'texture',
        path: 'canvas.png',
        resolved_path: 'https://webview-uri/canvas.png'
      };
      await rerender({ ...props, channelInput: updatedInput });

      expect(pathInput.value).toBe('canvas.png');
    });

    it('should not re-apply old resolved_path when user changes path', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'paw.jpg'
      };

      const props = {
        ...defaultProps(),
        channelInput: { ...textureInput, resolved_path: 'https://webview-uri/paw.jpg' } as any,
      };

      const { rerender } = render(ChannelConfigModal, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: 'paw.jpgf' } });

      expect(mockOnSave).toHaveBeenCalled();
      const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      const savedInput = lastCall[1];
      expect(savedInput.path).toBe('paw.jpgf');
      expect(savedInput.resolved_path).toBeUndefined();

      await rerender({ ...props });

      const latestCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      expect(latestCall[1].path).toBe('paw.jpgf');
      expect(latestCall[1].resolved_path).toBeUndefined();
    });

    it('should not reset user edits when resolved_path arrives', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: 'original.png',
        filter: 'linear'
      };

      const props = {
        ...defaultProps(),
        channelInput: textureInput,
      };

      const { rerender } = render(ChannelConfigModal, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      const updatedInput: any = {
        type: 'texture',
        path: 'original.png',
        resolved_path: 'https://webview-uri/original.png'
      };
      await rerender({ ...props, channelInput: updatedInput });

      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        filter: 'nearest'
      }));
    });
  });

  describe('Modal Stays Open During Edits', () => {
    it('should not call onClose when auto-saving changes', async () => {
      render(ChannelConfigModal, defaultProps());

      // Click Textures tab
      const texturesTab = screen.getByRole('tab', { name: 'Textures' });
      await fireEvent.click(texturesTab);

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should allow multiple consecutive edits without closing', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: textureInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './texture1.png' } });
      await fireEvent.input(pathInput, { target: { value: './texture2.png' } });

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'clamp' } });

      expect(mockOnSave.mock.calls.length).toBeGreaterThan(1);
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should only close when Close button is clicked', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: textureInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './new.png' } });

      expect(mockOnClose).not.toHaveBeenCalled();

      const closeButton = screen.getByText('Close');
      await fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('In-Progress Tabs', () => {
    it('should show in-progress placeholder for Cubemaps tab', async () => {
      render(ChannelConfigModal, defaultProps());

      const cubemapsTab = screen.getByRole('tab', { name: 'Cubemaps' });
      await fireEvent.click(cubemapsTab);

      expect(screen.getByText('Cubemap support is in progress')).toBeInTheDocument();
    });

    it('should show in-progress placeholder for Music tab', async () => {
      render(ChannelConfigModal, defaultProps());

      const musicTab = screen.getByRole('tab', { name: 'Music' });
      await fireEvent.click(musicTab);

      expect(screen.getByText('Music support is in progress')).toBeInTheDocument();
    });

    it('should show in-progress placeholder for Volumes tab', async () => {
      render(ChannelConfigModal, defaultProps());

      const volumesTab = screen.getByRole('tab', { name: 'Volumes' });
      await fireEvent.click(volumesTab);

      expect(screen.getByText('Volume support is in progress')).toBeInTheDocument();
    });
  });

  describe('Tab Switching', () => {
    it('should switch between tabs and update input type', async () => {
      render(ChannelConfigModal, defaultProps());

      // Click Textures tab
      const texturesTab = screen.getByRole('tab', { name: 'Textures' });
      await fireEvent.click(texturesTab);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({ type: 'texture' }));

      // Switch to Videos tab
      const videosTab = screen.getByRole('tab', { name: 'Videos' });
      await fireEvent.click(videosTab);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({ type: 'video' }));

      // Switch to Misc tab
      const miscTab = screen.getByRole('tab', { name: 'Misc' });
      await fireEvent.click(miscTab);
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({ type: 'buffer' }));
    });

    it('should not re-save when clicking the already active tab with matching type', async () => {
      const textureInput: ConfigInput = {
        type: 'texture',
        path: './test.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: textureInput,
      });

      // Textures tab should already be active
      mockOnSave.mockClear();
      const texturesTab = screen.getByRole('tab', { name: 'Textures' });
      await fireEvent.click(texturesTab);

      // Should not trigger a save since type matches
      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });
});
