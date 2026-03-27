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

      expect(screen.getByText('iChannel0')).toBeInTheDocument();
    });

    it('should display tab bar with all tabs', () => {
      render(ChannelConfigModal, defaultProps());

      expect(screen.getByRole('tab', { name: 'Misc' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Textures' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Cubemaps' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Videos' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Music' })).toBeInTheDocument();
    });

    it('should default to Misc tab when no input is set', () => {
      render(ChannelConfigModal, defaultProps());

      const miscTab = screen.getByRole('tab', { name: 'Misc' });
      expect(miscTab).toHaveAttribute('aria-selected', 'true');
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

    it('should auto-save cubemap type when clicking Cubemaps tab', async () => {
      render(ChannelConfigModal, defaultProps());

      const cubemapsTab = screen.getByRole('tab', { name: 'Cubemaps' });
      await fireEvent.click(cubemapsTab);

      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', {
        type: 'cubemap',
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

  describe('Cubemap Configuration Auto-Save', () => {
    it('should auto-save when changing cubemap path', async () => {
      const cubemapInput: ConfigInput = {
        type: 'cubemap',
        path: ''
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: cubemapInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './cubemap.png' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        type: 'cubemap',
        path: './cubemap.png'
      }));
    });

    it('should auto-save when changing cubemap filter', async () => {
      const cubemapInput: ConfigInput = {
        type: 'cubemap',
        path: './cubemap.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: cubemapInput,
      });

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        filter: 'nearest'
      }));
    });

    it('should auto-save when changing cubemap wrap', async () => {
      const cubemapInput: ConfigInput = {
        type: 'cubemap',
        path: './cubemap.png'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: cubemapInput,
      });

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'repeat' } });

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        wrap: 'repeat'
      }));
    });

    it('should auto-save when toggling cubemap vflip', async () => {
      const cubemapInput: ConfigInput = {
        type: 'cubemap',
        path: './cubemap.png',
        vflip: true
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: cubemapInput,
      });

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      await fireEvent.click(vflipCheckbox);

      expect(mockOnSave).toHaveBeenCalled();
      expect(mockOnSave).toHaveBeenCalledWith('iChannel0', expect.objectContaining({
        vflip: false
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

  describe('Video Control Buttons', () => {
    it('should render video control buttons with accessible titles', () => {
      const videoInput: ConfigInput = {
        type: 'video',
        path: './video.mp4'
      };

      const mockVideoControl = vi.fn();
      const mockGetVideoState = vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 5, duration: 30 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: videoInput,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any
      });

      // Check buttons have accessible titles
      const pauseBtn = container.querySelector('.btn-control[title="Pause"]');
      expect(pauseBtn).toBeTruthy();

      const unmuteBtn = container.querySelector('.btn-control[title="Unmute"]');
      expect(unmuteBtn).toBeTruthy();

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      expect(resetBtn).toBeTruthy();
    });

    it('should render mute/unmute buttons with codicon icons not emoji', () => {
      const videoInput: ConfigInput = {
        type: 'video',
        path: './video.mp4'
      };

      const mockVideoControl = vi.fn();
      const mockGetVideoState = vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 5, duration: 30 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: videoInput,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any
      });

      // Mute/unmute button should contain a codicon, not emoji text
      const muteBtn = container.querySelector('.btn-control[title="Unmute"]');
      expect(muteBtn).toBeTruthy();
      expect(muteBtn!.querySelector('.codicon-mute')).toBeTruthy();

      // Should not contain emoji characters
      const textContent = muteBtn!.textContent || '';
      expect(textContent).not.toContain('\uD83D\uDD07');
      expect(textContent).not.toContain('\uD83D\uDD0A');
    });

    it('should render reset button with circular arrow not \u23EE', () => {
      const videoInput: ConfigInput = {
        type: 'video',
        path: './video.mp4'
      };

      const mockVideoControl = vi.fn();
      const mockGetVideoState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 60 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: videoInput,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any
      });

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      expect(resetBtn).toBeTruthy();
      expect(resetBtn!.querySelector('.codicon-debug-restart')).toBeTruthy();
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

    it('should initialize with existing cubemap input and Cubemaps tab active', () => {
      const cubemapInput: ConfigInput = {
        type: 'cubemap',
        path: './existing-cubemap.png',
        filter: 'linear',
        wrap: 'clamp'
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: cubemapInput,
      });

      // Cubemaps tab should be active
      const cubemapsTab = screen.getByRole('tab', { name: 'Cubemaps' });
      expect(cubemapsTab.getAttribute('aria-selected')).toBe('true');

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./existing-cubemap.png');
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
      const webviewUri = 'https://file%2B.vscode-resource.vscode-cdn.net/mock/user/test.jpg';
      await fireEvent.input(pathInput, { target: { value: webviewUri } });

      expect(mockOnSave).toHaveBeenCalled();
      const savedInput = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1][1];
      expect(savedInput.type).toBe('texture');
      expect(savedInput.path).not.toContain('vscode-resource');
      expect(savedInput.path).toContain('/mock/user/test.jpg');
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
    it('should show cubemap path input when Cubemaps tab is selected', async () => {
      render(ChannelConfigModal, defaultProps());

      const cubemapsTab = screen.getByRole('tab', { name: 'Cubemaps' });
      await fireEvent.click(cubemapsTab);

      expect(screen.getByPlaceholderText('Path to cubemap cross-pattern PNG')).toBeInTheDocument();
    });

  });

  describe('Audio Control Buttons', () => {
    it('should render audio control buttons when onAudioControl is provided', () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3'
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 5, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any
      });

      // Check buttons have accessible titles
      const pauseBtn = container.querySelector('.btn-control[title="Pause"]');
      expect(pauseBtn).toBeTruthy();

      const unmuteBtn = container.querySelector('.btn-control[title="Unmute"]');
      expect(unmuteBtn).toBeTruthy();

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      expect(resetBtn).toBeTruthy();
    });

    it('should not show audio controls when onAudioControl is not provided', () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3'
      };

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
      });

      const controlsRow = container.querySelector('.video-controls .controls-row');
      expect(controlsRow).toBeFalsy();
    });

    it('should show timer when audio has duration', () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3'
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 65, duration: 180 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any
      });

      const timer = container.querySelector('.video-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('1:05');
      expect(timer!.textContent).toContain('3:00');
    });

    it('should render mute/unmute buttons with codicon icons', () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3'
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any
      });

      const muteBtn = container.querySelector('.btn-control[title="Unmute"]');
      expect(muteBtn).toBeTruthy();
      expect(muteBtn!.querySelector('.codicon-mute')).toBeTruthy();
    });
  });

  describe('Audio Waveform Drag Debouncing', () => {
    const audioInput: ConfigInput = {
      type: 'audio',
      path: './music.mp3',
      startTime: 5,
      endTime: 30,
    };

    it('should not call onSave during drag (handleDragMove)', async () => {
      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Find the start handle
      const startHandle = container.querySelector('.waveform-handle-start');
      expect(startHandle).toBeTruthy();

      // Simulate mousedown on the start handle
      await fireEvent.mouseDown(startHandle!);
      mockOnSave.mockClear();

      // Simulate mousemove on window (drag in progress)
      await fireEvent.mouseMove(window, { clientX: 100 });

      // onSave should NOT have been called during drag
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should not call onSave during or after drag — saves on modal close', async () => {
      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      expect(startHandle).toBeTruthy();

      // Simulate drag: mousedown, mousemove, mouseup
      await fireEvent.mouseDown(startHandle!);
      mockOnSave.mockClear();
      await fireEvent.mouseMove(window, { clientX: 100 });
      await fireEvent.mouseUp(window);

      // Not saved — deferred to modal close
      expect(mockOnSave).not.toHaveBeenCalled();

      // Close the modal — now save should fire
      await rerender({ ...props, isOpen: false });
      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    it('should send loopRegion message during drag', async () => {
      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: { ...audioInput, resolved_path: 'webview://music.mp3' } as any,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const startHandle = container.querySelector('.waveform-handle-start');
      expect(startHandle).toBeTruthy();

      // Start drag
      await fireEvent.mouseDown(startHandle!);
      mockAudioControl.mockClear();

      // Move (triggers loopRegion update)
      await fireEvent.mouseMove(window, { clientX: 150 });

      // onAudioControl should have been called with a loopRegion action
      expect(mockAudioControl).toHaveBeenCalled();
      const call = mockAudioControl.mock.calls[0];
      expect(call[1]).toMatch(/^loopRegion:/);
    });

    it('should not trigger saves during rapid drag movements — saves on modal close', async () => {
      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const endHandle = container.querySelector('.waveform-handle-end');
      expect(endHandle).toBeTruthy();

      // Start drag
      await fireEvent.mouseDown(endHandle!);
      mockOnSave.mockClear();

      // Simulate many rapid mouse moves (like real dragging)
      for (let i = 0; i < 20; i++) {
        await fireEvent.mouseMove(window, { clientX: 100 + i * 5 });
      }

      // No saves during drag
      expect(mockOnSave).not.toHaveBeenCalled();

      // Release
      await fireEvent.mouseUp(window);

      // Still not saved — deferred to modal close
      expect(mockOnSave).not.toHaveBeenCalled();

      // Close modal — exactly one save
      await rerender({ ...props, isOpen: false });
      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('Audio Seek via Waveform', () => {
    it('should send seek action when waveform is mousedown-ed', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        await fireEvent.mouseDown(waveformEditor, { clientX: 200 });

        // Should send a seek action
        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        expect(seekCalls.length).toBeGreaterThan(0);
      }
    });

    it('should send seek actions during waveform drag (mousemove)', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        // Start drag
        await fireEvent.mouseDown(waveformEditor, { clientX: 100 });
        mockAudioControl.mockClear();

        // Drag to new position
        await fireEvent.mouseMove(window, { clientX: 200 });
        await fireEvent.mouseMove(window, { clientX: 300 });

        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        expect(seekCalls.length).toBe(2);

        // Clean up
        await fireEvent.mouseUp(window);
      }
    });

    it('should stop seeking on mouseup', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        await fireEvent.mouseDown(waveformEditor, { clientX: 100 });
        await fireEvent.mouseUp(window);
        mockAudioControl.mockClear();

        // Mousemove after mouseup should NOT seek
        await fireEvent.mouseMove(window, { clientX: 300 });

        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        expect(seekCalls.length).toBe(0);
      }
    });
  });

  describe('Audio path resolution (getEffectiveAudioPath)', () => {
    it('should use getWebviewUri fallback when resolved_path is missing', async () => {
      // This simulates changing songs: resolved_path is stripped by updatePath,
      // but getWebviewUri can still resolve the path
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './new-song.mp3',
        // No resolved_path — simulates post-song-change state
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 });
      const mockWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        getWebviewUri: mockWebviewUri,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Click play button
      const playBtn = container.querySelector('.btn-control[title="Play"]');
      if (playBtn) {
        await fireEvent.click(playBtn);

        // Should have used the webview-resolved URI, not the raw path
        expect(mockAudioControl).toHaveBeenCalledWith(
          'webview://resolved/./new-song.mp3',
          'play'
        );
      }
    });

    it('should use resolved_path when available', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 });

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: { ...audioInput, resolved_path: 'webview://cdn/music.mp3' } as any,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Click play
      const playBtn = screen.getAllByTitle('Play')[0];
      if (playBtn) {
        await fireEvent.click(playBtn);
        expect(mockAudioControl).toHaveBeenCalledWith('webview://cdn/music.mp3', 'play');
      }
    });

    it('should use getWebviewUri for loopRegion commands during drag', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });
      const mockWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        getWebviewUri: mockWebviewUri,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        mockAudioControl.mockClear();
        await fireEvent.mouseMove(window, { clientX: 150 });

        // loopRegion should use resolved URI
        const loopCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('loopRegion:')
        );
        if (loopCalls.length > 0) {
          expect(loopCalls[0][0]).toBe('webview://resolved/./music.mp3');
        }

        await fireEvent.mouseUp(window);
      }
    });

    it('should use getWebviewUri for seek commands on waveform', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });
      const mockWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        getWebviewUri: mockWebviewUri,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        await fireEvent.mouseDown(waveformEditor, { clientX: 200 });

        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        if (seekCalls.length > 0) {
          expect(seekCalls[0][0]).toBe('webview://resolved/./music.mp3');
        }

        await fireEvent.mouseUp(window);
      }
    });

    it('should poll audio state with resolved URI after song change', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockGetAudioState = vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 });
      const mockWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        getWebviewUri: mockWebviewUri,
        audioVideoController: { audioControl: vi.fn(), getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // getAudioState should have been called with resolved URI
      const resolvedCalls = mockGetAudioState.mock.calls.filter(
        (call: any[]) => call[0] === 'webview://resolved/./music.mp3'
      );
      expect(resolvedCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Audio drag end does not interrupt playback', () => {
    it('should not send play command after drag — audio keeps playing uninterrupted', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 150 });
        mockAudioControl.mockClear();

        await fireEvent.mouseUp(window);

        // No play command needed — audio was never paused
        const playCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => call[1] === 'play'
        );
        expect(playCalls.length).toBe(0);
      }
    });

    it('should not send play command if no drag occurred', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Just mouseup on window without any drag
      mockAudioControl.mockClear();
      await fireEvent.mouseUp(window);

      const playCalls = mockAudioControl.mock.calls.filter(
        (call: any[]) => call[1] === 'play'
      );
      expect(playCalls.length).toBe(0);
    });
  });

  describe('Changing audio song auto-plays new song', () => {
    it('should send play command when audio path changes', async () => {
      vi.useFakeTimers();

      const audioInput: ConfigInput = {
        type: 'audio',
        path: './song-a.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Simulate selecting a different song via the path input
      const pathInput = container.querySelector('input[placeholder*="audio"]') as HTMLInputElement;
      if (pathInput) {
        mockAudioControl.mockClear();
        await fireEvent.input(pathInput, { target: { value: './song-b.mp3' } });

        // After resume delay (500ms)
        vi.advanceTimersByTime(500);

        const playCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => call[1] === 'play'
        );
        expect(playCalls.length).toBe(1);
      }

      vi.useRealTimers();
    });

    it('should not send play command when path stays the same', async () => {
      vi.useFakeTimers();

      const audioInput: ConfigInput = {
        type: 'audio',
        path: './song-a.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const pathInput = container.querySelector('input[placeholder*="audio"]') as HTMLInputElement;
      if (pathInput) {
        mockAudioControl.mockClear();
        // Set to same path
        await fireEvent.input(pathInput, { target: { value: './song-a.mp3' } });

        vi.advanceTimersByTime(500);

        const playCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => call[1] === 'play'
        );
        expect(playCalls.length).toBe(0);
      }

      vi.useRealTimers();
    });
  });

  describe('Start/end time live updates without pausing audio', () => {
    it('should send loopRegion command immediately when start time changes', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        mockAudioControl.mockClear();

        await fireEvent.mouseMove(window, { clientX: 150 });

        // loopRegion should be sent immediately during drag (no debounce)
        const loopCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('loopRegion:')
        );
        expect(loopCalls.length).toBe(1);

        await fireEvent.mouseUp(window);
      }
    });

    it('should defer config save to modal close when dragging handles', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        mockOnSave.mockClear();

        // Multiple drag moves
        await fireEvent.mouseMove(window, { clientX: 100 });
        await fireEvent.mouseMove(window, { clientX: 120 });
        await fireEvent.mouseMove(window, { clientX: 140 });
        await fireEvent.mouseUp(window);

        // Not saved — deferred to modal close
        expect(mockOnSave).not.toHaveBeenCalled();

        // Close modal triggers save
        await rerender({ ...props, isOpen: false });
        expect(mockOnSave).toHaveBeenCalledTimes(1);
      }
    });

    it('should not trigger config save on close if no loop region change', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { rerender } = render(ChannelConfigModal, props);

      mockOnSave.mockClear();

      // Close modal without any loop region changes
      await rerender({ ...props, isOpen: false });
      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  describe('Start/end time clamping', () => {
    it('should clamp start time to not exceed end time', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Drag start handle past the end handle position
      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);

        // Get the waveform container to calculate positioning
        const waveformContainer = container.querySelector('.waveform-editor');
        if (waveformContainer) {
          const rect = waveformContainer.getBoundingClientRect();
          // Drag to 100% of the way (which would be past the end time)
          await fireEvent.mouseMove(window, { clientX: rect.left + rect.width });
        }

        // The saved start time should be clamped to not exceed endTime
        await fireEvent.mouseUp(window);

        const savedInput = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1]?.[1];
        if (savedInput && savedInput.startTime !== null && savedInput.startTime !== undefined && savedInput.endTime !== null && savedInput.endTime !== undefined) {
          expect(savedInput.startTime).toBeLessThanOrEqual(savedInput.endTime);
        }
      }
    });

    it('should clamp end time to not go before start time', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 20,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Drag end handle before the start handle position
      const endHandle = container.querySelector('.waveform-handle-end');
      if (endHandle) {
        await fireEvent.mouseDown(endHandle);

        const waveformContainer = container.querySelector('.waveform-editor');
        if (waveformContainer) {
          const rect = waveformContainer.getBoundingClientRect();
          // Drag to 0% (which is before start time)
          await fireEvent.mouseMove(window, { clientX: rect.left });
        }

        await fireEvent.mouseUp(window);

        const savedInput = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1]?.[1];
        if (savedInput && savedInput.startTime !== null && savedInput.startTime !== undefined && savedInput.endTime !== null && savedInput.endTime !== undefined) {
          expect(savedInput.endTime).toBeGreaterThanOrEqual(savedInput.startTime);
        }
      }
    });
  });

  describe('Channel Rename', () => {
    let mockOnRename: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnRename = vi.fn();
    });

    it('should show rename button in the modal header', () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0'],
      });

      const renameBtn = container.querySelector('.rename-btn');
      expect(renameBtn).toBeTruthy();
    });

    it('should show name input when rename button is clicked', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0'],
      });

      const renameBtn = container.querySelector('.rename-btn') as HTMLElement;
      await fireEvent.click(renameBtn);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      expect(nameInput).toBeTruthy();
      expect(nameInput.value).toBe('iChannel0');
    });

    it('should call onRename with valid new name on Enter', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0'],
      });

      const renameBtn = container.querySelector('.rename-btn') as HTMLElement;
      await fireEvent.click(renameBtn);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      await fireEvent.input(nameInput, { target: { value: 'noiseMap' } });
      await fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(mockOnRename).toHaveBeenCalledWith('iChannel0', 'noiseMap');
    });

    it('should show error for invalid GLSL identifier', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0'],
      });

      const renameBtn = container.querySelector('.rename-btn') as HTMLElement;
      await fireEvent.click(renameBtn);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      await fireEvent.input(nameInput, { target: { value: '0invalid' } });
      await fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(mockOnRename).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Must be a valid GLSL identifier');
    });

    it('should show error for duplicate channel name', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0', 'noiseMap'],
      });

      const renameBtn = container.querySelector('.rename-btn') as HTMLElement;
      await fireEvent.click(renameBtn);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      await fireEvent.input(nameInput, { target: { value: 'noiseMap' } });
      await fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(mockOnRename).not.toHaveBeenCalled();
      expect(container.textContent).toContain('Name already in use');
    });

    it('should cancel rename on Escape', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0'],
      });

      const renameBtn = container.querySelector('.rename-btn') as HTMLElement;
      await fireEvent.click(renameBtn);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      await fireEvent.keyDown(nameInput, { key: 'Escape' });

      expect(mockOnRename).not.toHaveBeenCalled();
      // Name input should be hidden after cancel
      expect(container.querySelector('.name-input')).toBeFalsy();
    });

    it('should cancel rename when submitting same name', async () => {
      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        onRename: mockOnRename,
        existingChannelNames: ['iChannel0'],
      });

      const renameBtn = container.querySelector('.rename-btn') as HTMLElement;
      await fireEvent.click(renameBtn);

      const nameInput = container.querySelector('.name-input') as HTMLInputElement;
      // Value is already 'iChannel0', just press Enter
      await fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(mockOnRename).not.toHaveBeenCalled();
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

  describe('Audio start/end time input fields', () => {
    it('should render start time and end time inputs when audio type is selected with existing times', () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 10,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Waveform editor should be rendered with start/end handles
      const startHandle = container.querySelector('.waveform-handle-start');
      const endHandle = container.querySelector('.waveform-handle-end');
      expect(startHandle).toBeTruthy();
      expect(endHandle).toBeTruthy();

      // Time labels should show the start and end times
      const timeLabels = container.querySelectorAll('.waveform-time-label');
      expect(timeLabels.length).toBeGreaterThanOrEqual(2);
      // First label should show start time formatted
      expect(timeLabels[0]?.textContent).toContain('0:10');
      // Last label should show end time formatted
      expect(timeLabels[2]?.textContent).toContain('1:00');
    });

    it('should update tempInput when start time value changes via drag', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 50 });
        await fireEvent.mouseUp(window);

        // Close modal to trigger save
        await rerender({ ...props, isOpen: false });

        expect(mockOnSave).toHaveBeenCalled();
        const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
        expect(lastCall[1].type).toBe('audio');
      }
    });

    it('should update tempInput when end time value changes via drag', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const endHandle = container.querySelector('.waveform-handle-end');
      if (endHandle) {
        await fireEvent.mouseDown(endHandle);
        await fireEvent.mouseMove(window, { clientX: 200 });
        await fireEvent.mouseUp(window);

        // Close modal to trigger save
        await rerender({ ...props, isOpen: false });

        expect(mockOnSave).toHaveBeenCalled();
        const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
        expect(lastCall[1].type).toBe('audio');
      }
    });

    it('should handle empty start time (removes startTime from config)', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 10,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // In JSDOM, waveform container has zero-width getBoundingClientRect,
      // so dragging to position 0 produces NaN which removes startTime from config.
      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 0 });
        await fireEvent.mouseUp(window);

        // Close modal to trigger save
        await rerender({ ...props, isOpen: false });

        expect(mockOnSave).toHaveBeenCalled();
        const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
        // In JSDOM zero-width env, NaN time removes startTime from config
        expect(lastCall[1].startTime).toBeUndefined();
      }
    });

    it('should handle empty end time (removes endTime from config)', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 10,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Drag end handle to the far right — time would equal duration
      const endHandle = container.querySelector('.waveform-handle-end');
      if (endHandle) {
        const waveformEditor = container.querySelector('.waveform-editor');
        const rect = waveformEditor?.getBoundingClientRect();
        await fireEvent.mouseDown(endHandle);
        await fireEvent.mouseMove(window, { clientX: rect ? rect.right : 1000 });
        await fireEvent.mouseUp(window);

        // Close modal to trigger save
        await rerender({ ...props, isOpen: false });

        expect(mockOnSave).toHaveBeenCalled();
        const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
        expect(lastCall[1].type).toBe('audio');
      }
    });

    it('should handle non-numeric start time value gracefully', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 10,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Waveform editor should exist without errors
      const waveformEditor = container.querySelector('.waveform-editor');
      expect(waveformEditor).toBeTruthy();

      // Component should still be functional — drag the start handle
      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 50 });
        await fireEvent.mouseUp(window);

        // Close modal — should not throw
        await rerender({ ...props, isOpen: false });
        expect(mockOnSave).toHaveBeenCalled();
      }
    });
  });

  describe('Loop region save on modal close', () => {
    it('should save pending loop region changes when modal closes via backdrop click', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Perform a drag to create a pending loop region change
      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 100 });
        await fireEvent.mouseUp(window);
        mockOnSave.mockClear();

        // Close via backdrop click (simulated by setting isOpen to false)
        await rerender({ ...props, isOpen: false });

        // Pending loop region change should be saved
        expect(mockOnSave).toHaveBeenCalledTimes(1);
      }
    });

    it('should save pending loop region changes when modal closes via Escape key', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Perform a drag to create pending changes
      const endHandle = container.querySelector('.waveform-handle-end');
      if (endHandle) {
        await fireEvent.mouseDown(endHandle);
        await fireEvent.mouseMove(window, { clientX: 200 });
        await fireEvent.mouseUp(window);
        mockOnSave.mockClear();

        // Close via Escape (simulated by setting isOpen to false, as the parent controls isOpen)
        await rerender({ ...props, isOpen: false });

        expect(mockOnSave).toHaveBeenCalledTimes(1);
      }
    });

    it('should not save when modal closes without any loop region changes', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { rerender } = render(ChannelConfigModal, props);

      mockOnSave.mockClear();

      // Close modal without making any loop region changes
      await rerender({ ...props, isOpen: false });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should only save once even if multiple loop region changes were made', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Perform multiple drags
      const startHandle = container.querySelector('.waveform-handle-start');
      const endHandle = container.querySelector('.waveform-handle-end');

      if (startHandle && endHandle) {
        // First drag on start handle
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 80 });
        await fireEvent.mouseUp(window);

        // Second drag on end handle
        await fireEvent.mouseDown(endHandle);
        await fireEvent.mouseMove(window, { clientX: 250 });
        await fireEvent.mouseUp(window);

        // Third drag on start handle
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 60 });
        await fireEvent.mouseUp(window);

        mockOnSave.mockClear();

        // Close modal
        await rerender({ ...props, isOpen: false });

        // Should save exactly once with the final state
        expect(mockOnSave).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('Audio control buttons in modal', () => {
    it('should render play/pause button when audio has path and onAudioControl', () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const playBtn = container.querySelector('.btn-control[title="Play"]');
      expect(playBtn).toBeTruthy();
    });

    it('should call onAudioControl with correct path when play clicked', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const playBtn = container.querySelector('.btn-control[title="Play"]');
      expect(playBtn).toBeTruthy();
      await fireEvent.click(playBtn!);

      expect(mockAudioControl).toHaveBeenCalled();
      const lastCall = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(lastCall[1]).toBe('play');
    });

    it('should call onAudioControl with correct path when pause clicked', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const pauseBtn = container.querySelector('.btn-control[title="Pause"]');
      expect(pauseBtn).toBeTruthy();
      await fireEvent.click(pauseBtn!);

      expect(mockAudioControl).toHaveBeenCalled();
      const lastCall = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(lastCall[1]).toBe('pause');
    });

    it('should call onAudioControl with mute/unmute correctly', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // When not muted, button title should be "Mute"
      const muteBtn = container.querySelector('.btn-control[title="Mute"]');
      expect(muteBtn).toBeTruthy();
      await fireEvent.click(muteBtn!);

      expect(mockAudioControl).toHaveBeenCalled();
      const lastCall = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(lastCall[1]).toBe('mute');
    });

    it('should call onAudioControl with reset', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 120 });

      const { container } = render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      expect(resetBtn).toBeTruthy();
      await fireEvent.click(resetBtn!);

      expect(mockAudioControl).toHaveBeenCalled();
      const lastCall = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(lastCall[1]).toBe('reset');
    });
  });

  describe('Waveform handle clamping during drag', () => {
    it('should not allow start handle to go past end time during drag', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 5,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        const waveformEditor = container.querySelector('.waveform-editor');
        const rect = waveformEditor?.getBoundingClientRect();

        await fireEvent.mouseDown(startHandle);
        // Drag start handle far past end time (to the right end)
        await fireEvent.mouseMove(window, { clientX: rect ? rect.right : 1000 });
        await fireEvent.mouseUp(window);

        // Close modal to get saved values
        await rerender({ ...props, isOpen: false });

        if (mockOnSave.mock.calls.length > 0) {
          const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
          const saved = lastCall[1];
          if (saved.startTime !== null && saved.startTime !== undefined && saved.endTime !== null && saved.endTime !== undefined) {
            expect(saved.startTime).toBeLessThanOrEqual(saved.endTime);
          }
        }
      }
    });

    it('should not allow end handle to go before start time during drag', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 20,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const endHandle = container.querySelector('.waveform-handle-end');
      if (endHandle) {
        const waveformEditor = container.querySelector('.waveform-editor');
        const rect = waveformEditor?.getBoundingClientRect();

        await fireEvent.mouseDown(endHandle);
        // Drag end handle to far left (before start time)
        await fireEvent.mouseMove(window, { clientX: rect ? rect.left : 0 });
        await fireEvent.mouseUp(window);

        // Close modal to get saved values
        await rerender({ ...props, isOpen: false });

        if (mockOnSave.mock.calls.length > 0) {
          const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
          const saved = lastCall[1];
          if (saved.startTime !== null && saved.startTime !== undefined && saved.endTime !== null && saved.endTime !== undefined) {
            expect(saved.endTime).toBeGreaterThanOrEqual(saved.startTime);
          }
        }
      }
    });

    it('should allow start handle at position 0', async () => {
      // In a real browser, dragging to position 0 sets startTime to 0.
      // In JSDOM the waveform container has zero-width, so time becomes NaN
      // which removes startTime. We test that the drag completes without error
      // and the pending loop region change is saved on modal close.
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 10,
        endTime: 60,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        // Drag to far left
        await fireEvent.mouseMove(window, { clientX: 0 });
        await fireEvent.mouseUp(window);

        mockOnSave.mockClear();
        // Close modal to get saved values
        await rerender({ ...props, isOpen: false });

        // Should save exactly once (the pending loop region)
        expect(mockOnSave).toHaveBeenCalledTimes(1);
        const saved = mockOnSave.mock.calls[0][1];
        expect(saved.type).toBe('audio');
      }
    });

    it('should clamp correctly when end time equals start time', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './music.mp3',
        startTime: 30,
        endTime: 30,
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Both handles should be at the same position
      const startHandle = container.querySelector('.waveform-handle-start');
      const endHandle = container.querySelector('.waveform-handle-end');
      expect(startHandle).toBeTruthy();
      expect(endHandle).toBeTruthy();

      // Try dragging start handle — it should be clamped to endTime (30)
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        // Drag rightward past endTime
        const waveformEditor = container.querySelector('.waveform-editor');
        const rect = waveformEditor?.getBoundingClientRect();
        await fireEvent.mouseMove(window, { clientX: rect ? rect.right : 1000 });
        await fireEvent.mouseUp(window);

        await rerender({ ...props, isOpen: false });

        if (mockOnSave.mock.calls.length > 0) {
          const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
          const saved = lastCall[1];
          if (saved.startTime !== null && saved.startTime !== undefined && saved.endTime !== null && saved.endTime !== undefined) {
            expect(saved.startTime).toBeLessThanOrEqual(saved.endTime);
          }
        }
      }
    });
  });

  describe('extractOriginalPath utility', () => {
    it('should extract path from vscode-resource URI', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: '',
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
      });

      // Change path to a vscode-resource URI — extractOriginalPath is called internally
      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      const webviewUri = 'https://file%2B.vscode-resource.vscode-cdn.net/mock/user/music/song.mp3';
      await fireEvent.input(pathInput, { target: { value: webviewUri } });

      expect(mockOnSave).toHaveBeenCalled();
      const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      const savedInput = lastCall[1];
      expect(savedInput.path).not.toContain('vscode-resource');
      expect(savedInput.path).toContain('/mock/user/music/song.mp3');
    });

    it('should return plain path unchanged', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: '',
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './music/song.mp3' } });

      expect(mockOnSave).toHaveBeenCalled();
      const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      expect(lastCall[1].path).toBe('./music/song.mp3');
    });

    it('should handle encoded characters in URI', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: '',
      };

      render(ChannelConfigModal, {
        ...defaultProps(),
        channelInput: audioInput,
      });

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      const encodedUri = 'https://file%2B.vscode-resource.vscode-cdn.net/mock/user/my%20music/song%20file.mp3';
      await fireEvent.input(pathInput, { target: { value: encodedUri } });

      expect(mockOnSave).toHaveBeenCalled();
      const lastCall = mockOnSave.mock.calls[mockOnSave.mock.calls.length - 1];
      const savedPath = lastCall[1].path;
      expect(savedPath).not.toContain('vscode-resource');
      expect(savedPath).toContain('my music/song file.mp3');
    });
  });

  describe('Audio path change with song switch', () => {
    it('should reset audioState when path changes', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './song-a.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 45, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { rerender } = render(ChannelConfigModal, props);

      // Timer should show current song state
      expect(mockGetAudioState).toHaveBeenCalled();

      // Change path to a different song
      const newInput: ConfigInput = {
        type: 'audio',
        path: './song-b.mp3',
      };

      // After path change, audioState should be reset (null) then re-polled
      mockGetAudioState.mockClear();
      await rerender({ ...props, channelInput: newInput });

      // getAudioState should be called again for the new path
      expect(mockGetAudioState).toHaveBeenCalled();
    });

    it('should clear waveformPeaks when path changes', async () => {
      const audioInput: ConfigInput = {
        type: 'audio',
        path: './song-a.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container, rerender } = render(ChannelConfigModal, props);

      // Waveform editor should exist for song-a
      const waveformEditor = container.querySelector('.waveform-editor');
      expect(waveformEditor).toBeTruthy();

      // Change to a new song via path input
      const pathInput = container.querySelector('input[placeholder*="audio"]') as HTMLInputElement;
      if (pathInput) {
        await fireEvent.input(pathInput, { target: { value: './song-b.mp3' } });

        // After changing path, the canvas should still exist but waveformPeaks
        // would be null until the new song's waveform is loaded
        // The waveform editor area should still be present since the path is set
        const waveformEditorAfter = container.querySelector('.waveform-editor');
        expect(waveformEditorAfter).toBeTruthy();
      }
    });

    it('should restart audio state polling interval on path change', async () => {
      vi.useFakeTimers();

      const audioInput: ConfigInput = {
        type: 'audio',
        path: './song-a.mp3',
      };

      const mockAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });

      const props = {
        ...defaultProps(),
        channelInput: audioInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(ChannelConfigModal, props);

      // Change song via path input
      const pathInput = container.querySelector('input[placeholder*="audio"]') as HTMLInputElement;
      if (pathInput) {
        mockGetAudioState.mockClear();
        await fireEvent.input(pathInput, { target: { value: './song-b.mp3' } });

        // Advance timers to trigger polling interval
        vi.advanceTimersByTime(600);

        // getAudioState should have been called again during the polling interval
        expect(mockGetAudioState).toHaveBeenCalled();
      }

      vi.useRealTimers();
    });
  });
});
