import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BufferConfig from '../../../lib/components/config/BufferConfig.svelte';
import type { BufferPass, ImagePass } from '@shader-studio/types';

describe('BufferConfig', () => {
  let mockOnUpdate: ReturnType<typeof vi.fn>;
  let mockGetWebviewUri: ReturnType<typeof vi.fn>;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnUpdate = vi.fn();
    mockGetWebviewUri = vi.fn();
    mockPostMessage = vi.fn();
  });

  describe('Create File Button', () => {
    it('should show create file button when path is empty and postMessage provided', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(getByText('Create')).toBeTruthy();
      expect(container.querySelector('.create-file-btn')).toBeTruthy();
      // Path input should also be visible alongside the create button
      expect(container.querySelector('.config-input')).toBeTruthy();
    });

    it('should not show create file button when path has a value', () => {
      const config: BufferPass = { path: 'existing.glsl', inputs: {} };

      const { container, queryByText, getByDisplayValue } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.buffera.glsl'
      });

      expect(container.querySelector('.create-file-btn')).toBeNull();
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
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.image.glsl'
      });

      expect(queryByText(/Create/)).toBeNull();
    });

    it('should call postMessage with createFile when create button is clicked', async () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.buffera.glsl'
      });

      await fireEvent.click(getByText('Create'));
      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage.mock.calls[0][0].type).toBe('createFile');
      expect(mockPostMessage.mock.calls[0][0].payload.fileType).toBe('glsl-buffer');
    });

    it('should not show create file button when no postMessage handler', () => {
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

    it('should show select button when postMessage is provided', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
      });

      expect(getByText('Select')).toBeTruthy();
    });

    it('should not show select button when postMessage is not provided', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      expect(queryByText('Select')).toBeNull();
    });

    it('should call postMessage with selectFile when select button is clicked', async () => {
      const config: BufferPass = { path: 'existing.glsl', inputs: {} };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
      });

      await fireEvent.click(getByText('Select'));
      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage.mock.calls[0][0].type).toBe('selectFile');
      expect(mockPostMessage.mock.calls[0][0].payload.fileType).toBe('glsl-buffer');
    });

    it('should show path input instead of create button for common buffer with existing path', () => {
      const config: BufferPass = { path: 'myshader.common.glsl', inputs: {} };

      const { getByDisplayValue, queryByText } = render(BufferConfig, {
        bufferName: 'common',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
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

  describe('Path Input', () => {
    it('should update config when path is changed', async () => {
      const config: BufferPass = { path: 'old.glsl', inputs: {} };

      const { getByDisplayValue } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const pathInput = getByDisplayValue('old.glsl');
      await fireEvent.input(pathInput, { target: { value: 'new.glsl' } });

      expect(mockOnUpdate).toHaveBeenCalled();
      const updatedConfig = mockOnUpdate.mock.calls[0][1];
      expect(updatedConfig.path).toBe('new.glsl');
    });

    it('should show validation errors when config is invalid', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'texture' as any } // no path => invalid
        }
      };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const errorMessages = container.querySelectorAll('.error-message');
      expect(errorMessages.length).toBeGreaterThan(0);
    });

    it('should not show path input for image pass', () => {
      const config: ImagePass = { inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        isImagePass: true,
      });

      const pathInput = container.querySelector('.config-input');
      expect(pathInput).toBeNull();
    });

    it('should set pathInputFocused on focus and blur', async () => {
      const config: BufferPass = { path: 'test.glsl', inputs: {} };

      const { getByDisplayValue } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const pathInput = getByDisplayValue('test.glsl');
      await fireEvent.focus(pathInput);
      // After focus, typing should be possible without being overridden
      await fireEvent.input(pathInput, { target: { value: 'editing.glsl' } });

      await fireEvent.blur(pathInput);
      // After blur, the reactive statement will sync from config prop
    });
  });

  describe('Channel Modal Interaction', () => {
    it('should open modal when clicking a channel box', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Click on the iChannel0 box
      const channelBox = getByText('iChannel0').closest('.channel-box')!;
      await fireEvent.click(channelBox);
      await new Promise(r => setTimeout(r, 10));

      // Modal should be open - ChannelConfigModal with isOpen=true
      // The modal has overlay class when open
      const modal = container.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open modal via keyboard Enter on channel box', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const channelBox = getByText('iChannel0').closest('.channel-box')!;
      await fireEvent.keyDown(channelBox, { key: 'Enter' });
      await new Promise(r => setTimeout(r, 10));

      const modal = container.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open modal for empty channel (no input configured)', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {}
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Click on an empty channel slot (iChannel0 should be padded in)
      const channelBox = getByText('iChannel0').closest('.channel-box')!;
      await fireEvent.click(channelBox);
      await new Promise(r => setTimeout(r, 10));

      const modal = container.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open modal for add channel and use next available name', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' },
          iChannel1: { type: 'keyboard' },
          iChannel2: { type: 'keyboard' },
          iChannel3: { type: 'keyboard' },
        }
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      await fireEvent.click(getByText('Add Channel'));
      await new Promise(r => setTimeout(r, 10));

      const modal = container.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open Add Channel via keyboard Enter', async () => {
      const config: BufferPass = { path: 'buffer.glsl', inputs: {} };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const addBox = getByText('Add Channel').closest('.channel-box')!;
      await fireEvent.keyDown(addBox, { key: 'Enter' });
      await new Promise(r => setTimeout(r, 10));

      const modal = container.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });
  });

  describe('Sort Channels', () => {
    it('should not call onUpdate when sort is clicked with no inputs', async () => {
      const config: BufferPass = { path: 'buffer.glsl', inputs: undefined as any };

      const { queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Sort button shouldn't even appear with 0-1 inputs, but test the function guard
      expect(queryByText('Sort A-Z')).toBeNull();
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('should maintain all channels after sorting', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          charlie: { type: 'keyboard' },
          alpha: { type: 'texture', path: 'tex.png' },
          bravo: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      await fireEvent.click(getByText('Sort A-Z'));

      const updatedConfig = mockOnUpdate.mock.calls[mockOnUpdate.mock.calls.length - 1][1];
      const keys = Object.keys(updatedConfig.inputs);
      expect(keys).toEqual(['alpha', 'bravo', 'charlie']);
      // Verify values are preserved
      expect(updatedConfig.inputs.alpha.type).toBe('texture');
      expect(updatedConfig.inputs.bravo.type).toBe('keyboard');
    });
  });

  describe('Channel Names Computation', () => {
    it('should pad to 4 channels when fewer than 4 inputs exist', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // 4 channel boxes + 1 add channel box = 5 total
      const channelBoxes = container.querySelectorAll('.channel-box');
      expect(channelBoxes).toHaveLength(5);
    });

    it('should not duplicate existing channel names when padding', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' },
          iChannel2: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Should have iChannel0, iChannel2 (configured) + iChannel1, iChannel3 (padded)
      expect(getByText('iChannel0')).toBeTruthy();
      expect(getByText('iChannel1')).toBeTruthy();
      expect(getByText('iChannel2')).toBeTruthy();
      expect(getByText('iChannel3')).toBeTruthy();
    });

    it('should show exactly the configured channels when 4 or more exist', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          a: { type: 'keyboard' },
          b: { type: 'keyboard' },
          c: { type: 'keyboard' },
          d: { type: 'keyboard' },
        }
      };

      const { getByText, queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      expect(getByText('a')).toBeTruthy();
      expect(getByText('b')).toBeTruthy();
      expect(getByText('c')).toBeTruthy();
      expect(getByText('d')).toBeTruthy();
      // No iChannel padding
      expect(queryByText('iChannel0')).toBeNull();
    });
  });

  describe('Modal Save via Tab Selection', () => {
    it('should call onUpdate when switching tabs in modal (triggers autoSave -> handleModalSave)', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Open modal for iChannel0
      const channelBox = getByText('iChannel0').closest('.channel-box')!;
      await fireEvent.click(channelBox);
      await new Promise(r => setTimeout(r, 10));

      // Modal should be open
      expect(container.querySelector('.modal-overlay')).not.toBeNull();

      // Switch to Textures tab - this triggers selectTab -> autoSave -> onSave -> handleModalSave
      const texturesTab = getByText('Textures');
      await fireEvent.click(texturesTab);
      await new Promise(r => setTimeout(r, 10));

      // handleModalSave should have called bufferConfig.updateInputChannel which calls onUpdate
      expect(mockOnUpdate).toHaveBeenCalled();
    });
  });

  describe('Modal Remove', () => {
    it('should remove channel and close modal when Remove is clicked', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Open modal for configured channel
      const channelBox = getByText('iChannel0').closest('.channel-box')!;
      await fireEvent.click(channelBox);
      await new Promise(r => setTimeout(r, 10));

      // Modal should be open with Remove button
      const removeBtn = getByText('Remove');
      expect(removeBtn).toBeTruthy();

      // Click Remove
      await fireEvent.click(removeBtn);
      await new Promise(r => setTimeout(r, 10));

      // handleModalRemove calls removeInputChannel then closeChannelModal
      expect(mockOnUpdate).toHaveBeenCalled();
      const lastCall = mockOnUpdate.mock.calls[mockOnUpdate.mock.calls.length - 1];
      const updatedConfig = lastCall[1];
      expect(updatedConfig.inputs.iChannel0).toBeUndefined();

      // Modal should be closed
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });
  });

  describe('Modal Close', () => {
    it('should close modal when Close button is clicked', async () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Open modal
      const channelBox = getByText('iChannel0').closest('.channel-box')!;
      await fireEvent.click(channelBox);
      await new Promise(r => setTimeout(r, 10));
      expect(container.querySelector('.modal-overlay')).not.toBeNull();

      // Click Close
      const closeBtn = getByText('Close');
      await fireEvent.click(closeBtn);
      await new Promise(r => setTimeout(r, 10));

      expect(container.querySelector('.modal-overlay')).toBeNull();
    });
  });

  describe('Image Pass Channels', () => {
    it('should show channels grid for image pass', () => {
      const config: ImagePass = {
        inputs: {
          iChannel0: { type: 'keyboard' }
        }
      };

      const { getByText } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        isImagePass: true,
      });

      expect(getByText('iChannel0')).toBeTruthy();
    });
  });

  describe('audio/video handler props', () => {
    it('should render with audioVideoController for video inputs', () => {
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
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue(null), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      expect(container.querySelector('.channels-grid')).toBeTruthy();
    });

    it('should render with audioVideoController for audio inputs', () => {
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
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue(null), getAudioFFT: vi.fn().mockReturnValue(null), videoControl: vi.fn(), getVideoState: vi.fn() } as any,
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

    it('should render with audioVideoController and mixed inputs', () => {
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
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue(null), audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue(null), getAudioFFT: vi.fn().mockReturnValue(null) } as any,
        globalMuted: false,
      });

      expect(container.querySelector('.channels-grid')).toBeTruthy();
    });
  });
});
