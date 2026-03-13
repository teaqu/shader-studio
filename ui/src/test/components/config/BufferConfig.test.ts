import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BufferConfig from '../../../lib/components/config/BufferConfig.svelte';
import type { BufferPass, ImagePass } from '@shader-studio/types';

describe('BufferConfig', () => {
  let mockOnUpdate: ReturnType<typeof vi.fn>;
  let mockGetWebviewUri: ReturnType<typeof vi.fn>;
  let mockOnCreateFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnUpdate = vi.fn();
    mockGetWebviewUri = vi.fn();
    mockOnCreateFile = vi.fn();
  });

  describe('Create File Button', () => {
    it('should show create file button when path is empty and suggestedPath provided', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(getByText('Create myshader.buffera.glsl')).toBeTruthy();
      // Path input should also be visible alongside the create button
      expect(container.querySelector('.config-input')).toBeTruthy();
    });

    it('should not show create file button when path has a value', () => {
      const config: BufferPass = { path: 'existing.glsl', inputs: {} };

      const { queryByText, getByDisplayValue } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(queryByText('Create myshader.buffera.glsl')).toBeNull();
      expect(getByDisplayValue('existing.glsl')).toBeTruthy();
    });

    it('should not show create file button for Image pass', () => {
      const config: ImagePass = { inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        isImagePass: true,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.image.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should call onCreateFile when create button is clicked', async () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.buffera.glsl'
      });

      await fireEvent.click(getByText('Create myshader.buffera.glsl'));
      expect(mockOnCreateFile).toHaveBeenCalledWith('BufferA');
    });

    it('should not show create file button when no suggestedPath', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: ''
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should not show create file button when no onCreateFile handler', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should show path input instead of create button for common buffer with existing path', () => {
      const config: BufferPass = { path: 'myshader.common.glsl', inputs: {} };

      const { getByDisplayValue, queryByText } = render(BufferConfig, {
        bufferName: 'common',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onCreateFile: mockOnCreateFile,
        suggestedPath: 'myshader.common.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
      expect(getByDisplayValue('myshader.common.glsl')).toBeTruthy();
    });
  });

  describe('Channel Grid', () => {
    it('should show channels grid for regular buffers', () => {
      const config: BufferPass = { path: 'buffer.glsl', inputs: {} };

      const { getAllByText, getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      // Should always show the 4 default channels even with empty inputs
      expect(getAllByText(/iChannel/)).toHaveLength(4);
      expect(getByText('Add Channel')).toBeTruthy();
    });

    it('should not show channels grid for common buffer', () => {
      const config: BufferPass = { path: 'common.glsl', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'common',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(queryByText('iChannel0')).toBeNull();
    });

    it('should show custom channel names in the grid', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          noiseMap: { type: 'texture', path: 'noise.jpg' },
          iChannel1: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(getByText('noiseMap')).toBeTruthy();
      expect(getByText('iChannel1')).toBeTruthy();
    });

    it('should not pad to 4 when 4 or more channels exist', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          a: { type: 'keyboard' },
          b: { type: 'keyboard' },
          c: { type: 'keyboard' },
          d: { type: 'keyboard' },
          e: { type: 'keyboard' }
        }
      };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      // 5 configured channels + 1 add channel box = 6 total channel boxes
      const channelBoxes = container.querySelectorAll('.channel-box');
      expect(channelBoxes).toHaveLength(6);
    });

    it('should show sort button when more than 1 input exists', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          zeta: { type: 'keyboard' },
          alpha: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(getByText('Sort A-Z')).toBeTruthy();
    });

    it('should not show sort button with 0 or 1 inputs', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(queryByText('Sort A-Z')).toBeNull();
    });

    it('should sort channels alphabetically when sort button is clicked', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          zeta: { type: 'keyboard' },
          alpha: { type: 'keyboard' },
          mid: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      await fireEvent.click(getByText('Sort A-Z'));

      expect(mockOnUpdate).toHaveBeenCalled();
      const updatedConfig = mockOnUpdate.mock.calls[mockOnUpdate.mock.calls.length - 1][1];
      const keys = Object.keys(updatedConfig.inputs);
      expect(keys).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('should open modal for next available iChannel when Add Channel is clicked', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      await fireEvent.click(getByText('Add Channel'));

      // The modal should open showing iChannel1 (next available)
      expect(getByText('iChannel1')).toBeTruthy();
    });

    it('should not show Add Channel button when at 16 channels', () => {
      const inputs: Record<string, any> = {};
      for (let i = 0; i < 16; i++) {
        inputs[`ch${i}`] = { type: 'keyboard' };
      }
      const config: BufferPass = { path: 'buffer.glsl', inputs };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      expect(queryByText('Add Channel')).toBeNull();
    });
  });

  describe('audio/video handler props', () => {
    it('should render with onVideoControl and getVideoState props', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'video', path: '/test/video.mp4' }
        }
      };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onVideoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue(null),
      });

      expect(container.querySelector('.channels-grid')).toBeTruthy();
    });

    it('should render with onAudioControl and getAudioState props', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'audio', path: '/test/audio.mp3' }
        }
      };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onAudioControl: vi.fn(),
        getAudioState: vi.fn().mockReturnValue(null),
        getAudioFFT: vi.fn().mockReturnValue(null),
      });

      expect(container.querySelector('.channels-grid')).toBeTruthy();
    });

    it('should render with globalMuted prop', () => {
      const config: ImagePass = { inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        isImagePass: true,
        globalMuted: true,
      });

      expect(container).toBeTruthy();
    });

    it('should render with all audio/video props together', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'video', path: '/test/video.mp4' },
          iChannel1: { type: 'audio', path: '/test/audio.mp3' },
        }
      };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        onVideoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue(null),
        onAudioControl: vi.fn(),
        getAudioState: vi.fn().mockReturnValue(null),
        getAudioFFT: vi.fn().mockReturnValue(null),
        globalMuted: false,
      });

      expect(container.querySelector('.channels-grid')).toBeTruthy();
    });
  });
});
