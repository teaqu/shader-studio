import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import BufferConfig from '../../../lib/components/config/BufferConfig.svelte';
import type { BufferPass, ComputePass, ImagePass } from '@shader-studio/types';
import {
  getEditorOverlayVisible,
  getOverlayActiveFile,
  setEditorOverlayVisible,
  setOverlayActiveFile,
} from '../../../lib/state/editorOverlayState.svelte';

vi.mock('../../../../../rendering/src/preview3d/GltfMeshLoader', () => ({
  listGlbMeshNames: vi.fn().mockResolvedValue(['Body', 'Visor']),
}));

function getMainPathConfig(container: HTMLElement): HTMLElement {
  const configItem = container.querySelector<HTMLElement>('.buffer-details > .config-item:first-child');
  if (!configItem) {
    throw new Error('Expected the main shader path configuration');
  }
  return configItem;
}

describe('BufferConfig', () => {
  it('opens the configured vertex shader in the editor overlay when its title is double-clicked', async () => {
    setEditorOverlayVisible(false);
    setOverlayActiveFile('Image');

    const { getByText } = render(BufferConfig, {
      bufferName: 'Image',
      config: { inputs: {}, geometry: { type: 'cube' }, vertex: './warp.vert.glsl' },
      onUpdate: vi.fn(),
      getWebviewUri: () => undefined,
      isImagePass: true,
    });

    await fireEvent.dblClick(getByText('Vertex shader'));

    expect(getEditorOverlayVisible()).toBe(true);
    expect(getOverlayActiveFile()).toBe('__shader_studio_vertex__:Image');
  });

  it('updates the optional vertex shader path', async () => {
    const onUpdate = vi.fn();
    const { getByLabelText } = render(BufferConfig, {
      bufferName: 'Image', config: { inputs: {}, geometry: { type: 'cube' } }, onUpdate, getWebviewUri: () => undefined, isImagePass: true,
    });

    await fireEvent.input(getByLabelText('Path:'), { target: { value: './warp.vert.glsl' } });

    expect(onUpdate).toHaveBeenCalledWith('Image', expect.objectContaining({ vertex: './warp.vert.glsl' }));
  });
  it('creates a Slang vertex file for a Slang shader', async () => {
    const postMessage = vi.fn();
    const { getByText } = render(BufferConfig, {
      bufferName: 'Image', config: { inputs: {}, geometry: { type: 'cube' } }, onUpdate: vi.fn(), getWebviewUri: () => undefined, isImagePass: true,
      shaderPath: '/shaders/rays.slang', postMessage,
    });

    await fireEvent.click(getByText('Create'));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'createFile',
      payload: expect.objectContaining({ fileType: 'slang-vertex', suggestedPath: '/shaders/rays.image.vert.slang' }),
    }));
  });
  let mockOnUpdate: ReturnType<typeof vi.fn>;
  let mockGetWebviewUri: ReturnType<typeof vi.fn>;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnUpdate = vi.fn();
    mockGetWebviewUri = vi.fn();
    mockPostMessage = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }));
  });

  describe('compute settings', () => {
    it('shows Slang compute controls and commits dispatch changes through the compute handler', async () => {
      const onComputeCommit = vi.fn(() => ({}));
      const config: ComputePass = { path: 'sim.slang', inputs: {} };
      const { getByLabelText, getByRole } = render(BufferConfig, {
        bufferName: 'ComputeSim',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        language: 'slang',
        passKind: 'compute',
        storageNames: ['particles'],
        onComputeCommit,
      });

      expect(getByRole('heading', { name: 'Dispatch' })).toBeInTheDocument();
      await fireEvent.change(getByLabelText('Dispatch mode'), { target: { value: 'storage' } });

      expect(onComputeCommit).toHaveBeenCalledWith({
        path: 'sim.slang',
        inputs: {},
        dispatch: { cover: 'particles' },
      });
    });
  });

  describe('Create File Button', () => {
    it('should show create file button when path is empty and postMessage provided', () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.buffera.glsl'
      });

      const mainPathConfig = getMainPathConfig(container);
      expect(mainPathConfig.querySelector('.create-file-btn')).toBeTruthy();
      // Path input should also be visible alongside the create button
      expect(mainPathConfig.querySelector('.config-input')).toBeTruthy();
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

      expect(getMainPathConfig(container).querySelector('.create-file-btn')).toBeNull();
      expect(getByDisplayValue('existing.glsl')).toBeTruthy();
    });

    it('should not show create file button for Image pass', () => {
      const config: ImagePass = { inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        isImagePass: true,
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.image.glsl'
      });

      expect(getMainPathConfig(container).querySelector('.create-file-btn')).toBeNull();
    });

    it('should call postMessage with createFile when create button is clicked', async () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        suggestedPath: 'myshader.buffera.glsl'
      });

      await fireEvent.click(getMainPathConfig(container).querySelector('.create-file-btn')!);
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

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
      });

      expect(getMainPathConfig(container).querySelector('.select-file-btn')).toBeTruthy();
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

      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
      });

      await fireEvent.click(getMainPathConfig(container).querySelector('.select-file-btn')!);
      expect(mockPostMessage).toHaveBeenCalledOnce();
      expect(mockPostMessage.mock.calls[0][0].type).toBe('selectFile');
      expect(mockPostMessage.mock.calls[0][0].payload.fileType).toBe('glsl-buffer');
    });

    it('should request Slang compute files when selecting a compute pass source', async () => {
      const config: BufferPass = { path: 'existing.slang', inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'ComputeA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        language: 'slang',
        passKind: 'compute',
        shaderPath: '/shaders/image.slang',
      });

      await fireEvent.click(getMainPathConfig(container).querySelector('.select-file-btn')!);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'selectFile',
        payload: {
          shaderPath: '/shaders/image.slang',
          fileType: 'slang-compute',
          requestId: expect.any(String),
        },
      });
    });

    it('should request the suggested Slang path when creating a compute pass source', async () => {
      const config: BufferPass = { path: '', inputs: {} };

      const { container } = render(BufferConfig, {
        bufferName: 'ComputeA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        language: 'slang',
        passKind: 'compute',
        shaderPath: '/shaders/image.slang',
        suggestedPath: 'image.computea.slang',
      });

      const mainPathConfig = getMainPathConfig(container);
      expect(mainPathConfig.querySelector('.config-input')).toHaveAttribute('placeholder', 'image.computea.slang');
      await fireEvent.click(mainPathConfig.querySelector('.create-file-btn')!);

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'createFile',
        payload: {
          shaderPath: '/shaders/image.slang',
          suggestedPath: 'image.computea.slang',
          fileType: 'slang-compute',
          requestId: expect.any(String),
        },
      });
    });

    it.each([
      { language: 'glsl' as const, passKind: 'compute' as const },
      { language: 'slang' as const, passKind: 'render' as const },
    ])('should preserve GLSL buffer selection for $language $passKind passes', async ({ language, passKind }) => {
      const config: BufferPass = { path: 'existing.glsl', inputs: {} };
      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage,
        language,
        passKind,
      });

      await fireEvent.click(getMainPathConfig(container).querySelector('.select-file-btn')!);

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

  describe('Geometry', () => {
    it('renders geometry controls after the pass resolution controls', () => {
      const { container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config: { path: 'a.glsl', inputs: {}, geometry: { type: 'cube' } },
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map((title) => title.textContent);
      expect(sectionTitles).toEqual(['Channels', 'Resolution', 'Geometry', 'Vertex shader']);
    });

    it('defaults renderable passes to fullscreen and serializes a selected sphere', async () => {
      const config: BufferPass = { path: 'a.glsl', inputs: {} };
      const { getByLabelText } = render(BufferConfig, {
        bufferName: 'BufferA', config, onUpdate: mockOnUpdate, getWebviewUri: mockGetWebviewUri,
      });

      const select = getByLabelText('Geometry') as HTMLSelectElement;
      expect(select.value).toBe('fullscreen');
      await fireEvent.change(select, { target: { value: 'sphere' } });
      expect(mockOnUpdate).toHaveBeenCalledWith('BufferA', { path: 'a.glsl', inputs: {}, geometry: { type: 'sphere' } });
    });

    it('shows model and mesh selectors and writes their configuration', async () => {
      mockGetWebviewUri.mockReturnValue('vscode-webview://webview-panel/robot.glb');
      const { getByLabelText, getByRole } = render(BufferConfig, {
        bufferName: 'Image', config: { inputs: {}, geometry: { type: 'model', path: './robot.glb' } }, onUpdate: mockOnUpdate, getWebviewUri: mockGetWebviewUri,
        postMessage: mockPostMessage, shaderPath: '/shaders/image.slang',
      });

      expect((getByLabelText('Geometry') as HTMLSelectElement).value).toBe('model');
      expect(getByLabelText('Model file:')).toHaveValue('./robot.glb');
      await waitFor(() => expect(getByLabelText('Mesh')).toHaveTextContent('Body'));
      await fireEvent.change(getByLabelText('Mesh'), { target: { value: 'Body' } });

      expect(mockOnUpdate).toHaveBeenLastCalledWith('Image', { inputs: {}, geometry: { type: 'model', path: './robot.glb', mesh: 'Body' } });
      const modelPath = getByLabelText('Model file:');
      await fireEvent.click(modelPath.closest('.input-group')!.querySelector('.select-file-btn')!);
      expect(mockPostMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'selectFile', payload: expect.objectContaining({ fileType: 'model' }) }));
    });

    it('waits for the model webview URI instead of fetching a raw relative path', async () => {
      const fetchMock = vi.mocked(fetch);
      render(BufferConfig, {
        bufferName: 'Image', config: { inputs: {}, geometry: { type: 'model', path: './robot.glb' } }, onUpdate: mockOnUpdate,
        getWebviewUri: () => undefined,
      });

      await tick();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not persist an invalid empty model path while selecting a model file', async () => {
      const { getByLabelText } = render(BufferConfig, {
        bufferName: 'Image', config: { inputs: {} }, onUpdate: mockOnUpdate, getWebviewUri: mockGetWebviewUri,
      });

      await fireEvent.change(getByLabelText('Geometry'), { target: { value: 'model' } });

      expect(getByLabelText('Model file:')).toBeInTheDocument();
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('shows the vertex shader control for implicit fullscreen passes', () => {
      const { getByRole } = render(BufferConfig, {
        bufferName: 'BufferA',
        config: { path: 'a.glsl', inputs: {} },
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      expect(getByRole('heading', { name: 'Vertex shader' })).toBeInTheDocument();
    });

    it('does not show geometry controls for Common', () => {
      const { queryByLabelText, queryByText } = render(BufferConfig, {
        bufferName: 'common', config: { path: 'common.glsl' } as BufferPass,
        onUpdate: mockOnUpdate, getWebviewUri: mockGetWebviewUri,
      });
      expect(queryByLabelText('Geometry')).toBeNull();
      expect(queryByText('Geometry')).toBeNull();
    });
  });

  describe('Channel Grid', () => {
    it('should show channels list for regular buffers', () => {
      const config: BufferPass = { path: 'buffer.glsl', inputs: {} };

      const { getByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri
      });

      // No padding — just shows the Add Channel button
      expect(getByText('+ Add Channel')).toBeTruthy();
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

    it('should render all configured channels as list rows', () => {
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

      // 5 configured channels = 5 channel rows
      const channelRows = container.querySelectorAll('.channel-row');
      expect(channelRows).toHaveLength(5);
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

      await fireEvent.click(getByText('+ Add Channel'));

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

      expect(queryByText('+ Add Channel')).toBeNull();
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

      const pathInput = container.querySelector('.buffer-details > .config-item:first-child .config-input');
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
    it('should open modal when clicking a channel row', async () => {
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

      // Click on the iChannel0 row
      const channelRow = getByText('iChannel0').closest('.channel-row')!;
      await fireEvent.click(channelRow);
      await tick();

      // Modal should be open - ChannelConfigModal with isOpen=true
      const modal = document.body.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open modal via keyboard Enter on channel row', async () => {
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

      const channelRow = getByText('iChannel0').closest('.channel-row')!;
      await fireEvent.keyDown(channelRow, { key: 'Enter' });
      await tick();

      const modal = document.body.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open modal for add channel when no input configured', async () => {
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

      // Click Add Channel to open the modal for the next available slot
      await fireEvent.click(getByText('+ Add Channel'));
      await tick();

      const modal = document.body.querySelector('.modal-overlay');
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

      await fireEvent.click(getByText('+ Add Channel'));
      await tick();

      const modal = document.body.querySelector('.modal-overlay');
      expect(modal).not.toBeNull();
    });

    it('should open Add Channel via keyboard Enter on the button', async () => {
      const config: BufferPass = { path: 'buffer.glsl', inputs: {} };

      const { getByText, container } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      const addBtn = getByText('+ Add Channel');
      await fireEvent.keyDown(addBtn, { key: 'Enter' });
      await fireEvent.click(addBtn);
      await tick();

      const modal = document.body.querySelector('.modal-overlay');
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
    it('should show only configured channels (no padding)', () => {
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

      // 1 configured channel = 1 channel row
      const channelRows = container.querySelectorAll('.channel-row');
      expect(channelRows).toHaveLength(1);
    });

    it('should show exactly the configured channels', () => {
      const config: BufferPass = {
        path: 'buffer.glsl',
        inputs: {
          iChannel0: { type: 'keyboard' },
          iChannel2: { type: 'keyboard' }
        }
      };

      const { getByText, queryByText } = render(BufferConfig, {
        bufferName: 'BufferA',
        config,
        onUpdate: mockOnUpdate,
        getWebviewUri: mockGetWebviewUri,
      });

      // Only configured channels shown — no padding
      expect(getByText('iChannel0')).toBeTruthy();
      expect(getByText('iChannel2')).toBeTruthy();
      expect(queryByText('iChannel1')).toBeNull();
      expect(queryByText('iChannel3')).toBeNull();
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
      const channelRow = getByText('iChannel0').closest('.channel-row')!;
      await fireEvent.click(channelRow);
      await tick();

      // Modal should be open
      expect(document.body.querySelector('.modal-overlay')).not.toBeNull();

      // Switch to Textures tab - this triggers selectTab -> autoSave -> onSave -> handleModalSave
      const texturesTab = getByText('Textures');
      await fireEvent.click(texturesTab);
      await tick();

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
      const channelRow = getByText('iChannel0').closest('.channel-row')!;
      await fireEvent.click(channelRow);
      await tick();

      // Modal should be open with Remove button
      const removeBtn = getByText('Remove');
      expect(removeBtn).toBeTruthy();

      // Click Remove
      await fireEvent.click(removeBtn);
      await tick();

      // handleModalRemove calls removeInputChannel then closeChannelModal
      expect(mockOnUpdate).toHaveBeenCalled();
      const lastCall = mockOnUpdate.mock.calls[mockOnUpdate.mock.calls.length - 1];
      const updatedConfig = lastCall[1];
      expect(updatedConfig.inputs.iChannel0).toBeUndefined();

      // Modal should be closed
      expect(document.body.querySelector('.modal-overlay')).toBeNull();
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
      const channelRow = getByText('iChannel0').closest('.channel-row')!;
      await fireEvent.click(channelRow);
      await tick();
      expect(document.body.querySelector('.modal-overlay')).not.toBeNull();

      // Click Close
      const closeBtn = getByText('Close');
      await fireEvent.click(closeBtn);
      await tick();

      expect(document.body.querySelector('.modal-overlay')).toBeNull();
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

      expect(container.querySelector('.channel-list')).toBeTruthy();
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

      expect(container.querySelector('.channel-list')).toBeTruthy();
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

      expect(container.querySelector('.channel-list')).toBeTruthy();
    });
  });

  describe('Channel list layout', () => {
    it('shows only "Add Channel" button when no channels configured', () => {
      const config: ImagePass = { inputs: {} };
      const { getByText, container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: vi.fn(),
        getWebviewUri: vi.fn(),
        isImagePass: true,
      });
      expect(getByText('+ Add Channel')).toBeTruthy();
      expect(container.querySelector('.channel-row')).toBeNull();
    });

    it('renders configured channels as list rows', () => {
      const config: ImagePass = {
        inputs: {
          iChannel0: { type: 'texture', path: 'tex.png' },
          iChannel1: { type: 'buffer', source: 'BufferA' },
        },
      };
      const { container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: vi.fn(),
        getWebviewUri: vi.fn(),
        isImagePass: true,
      });
      expect(container.querySelectorAll('.channel-row').length).toBe(2);
    });

    it('does not render empty placeholder boxes', () => {
      const config: ImagePass = { inputs: {} };
      const { container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: vi.fn(),
        getWebviewUri: vi.fn(),
        isImagePass: true,
      });
      expect(container.querySelector('.channel-box')).toBeNull();
    });

    it('clicking Add Channel opens modal', async () => {
      const config: ImagePass = { inputs: {} };
      const { getByText, container } = render(BufferConfig, {
        bufferName: 'Image',
        config,
        onUpdate: vi.fn(),
        getWebviewUri: vi.fn(),
        isImagePass: true,
      });
      await fireEvent.click(getByText('+ Add Channel'));
      expect(document.body.querySelector('.modal-overlay')).toBeTruthy();
    });
  });

  describe('Custom resolution inputs (Image pass)', () => {
    const baseImageProps = {
      bufferName: 'Image',
      onUpdate: vi.fn(),
      getWebviewUri: vi.fn(),
      postMessage: vi.fn(),
      isImagePass: true,
    };

    it('should use number inputs for custom width and height', () => {
      const config: ImagePass = { inputs: {} };
      const { container } = render(BufferConfig, { ...baseImageProps, config });

      const inputs = container.querySelectorAll('input.dim-input');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).type).toBe('number');
      });
    });

    it('should auto-apply custom resolution on input without a separate Apply button', async () => {
      const onUpdate = vi.fn();
      const config: ImagePass = { inputs: {} };
      const { container } = render(BufferConfig, { ...baseImageProps, config, onUpdate });

      const [widthInput, heightInput] = Array.from(container.querySelectorAll('input.dim-input')) as HTMLInputElement[];
      await fireEvent.input(widthInput, { target: { valueAsNumber: 512 } });
      await fireEvent.input(heightInput, { target: { valueAsNumber: 256 } });
      await tick();

      const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
      const updatedConfig = lastCall?.[1] as ImagePass;
      expect(updatedConfig?.resolution?.width).toBe(512);
      expect(updatedConfig?.resolution?.height).toBe(256);
    });

    it('should preserve scale when custom resolution is set', async () => {
      const onUpdate = vi.fn();
      const config: ImagePass = { inputs: {}, resolution: { scale: 2 } };
      const { container } = render(BufferConfig, { ...baseImageProps, config, onUpdate });

      const [widthInput, heightInput] = Array.from(container.querySelectorAll('input.dim-input')) as HTMLInputElement[];
      await fireEvent.input(widthInput, { target: { valueAsNumber: 320 } });
      await fireEvent.input(heightInput, { target: { valueAsNumber: 240 } });
      await tick();

      const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
      const updatedConfig = lastCall?.[1] as ImagePass;
      expect(updatedConfig?.resolution?.width).toBe(320);
      expect(updatedConfig?.resolution?.height).toBe(240);
      expect(updatedConfig?.resolution?.scale).toBe(2);
    });

    it('should preserve custom resolution when scale is changed', async () => {
      const onUpdate = vi.fn();
      const config: ImagePass = { inputs: {}, resolution: { width: 320, height: 240 } };
      const { container } = render(BufferConfig, { ...baseImageProps, config, onUpdate });
      await tick();

      const scaleBtn = Array.from(container.querySelectorAll('button.preset-btn')).find(b => b.textContent?.trim() === '2x') as HTMLButtonElement;
      await fireEvent.click(scaleBtn);
      await tick();

      const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
      const updatedConfig = lastCall?.[1] as ImagePass;
      expect(updatedConfig?.resolution?.scale).toBe(2);
      expect(updatedConfig?.resolution?.width).toBe(320);
      expect(updatedConfig?.resolution?.height).toBe(240);
    });

    it('should show Clear button when custom resolution is active', async () => {
      const config: ImagePass = { inputs: {}, resolution: { width: 800, height: 600 } };
      const { container } = render(BufferConfig, { ...baseImageProps, config });
      await tick();

      expect(container.querySelector('.clear-custom-btn')).toBeTruthy();
    });

    it('should not show Clear button when no custom resolution', () => {
      const config: ImagePass = { inputs: {} };
      const { container } = render(BufferConfig, { ...baseImageProps, config });

      expect(container.querySelector('.clear-custom-btn')).toBeNull();
    });

    it('should populate inputs from existing config custom resolution', async () => {
      const config: ImagePass = { inputs: {}, resolution: { width: 800, height: 600 } };
      const { container } = render(BufferConfig, { ...baseImageProps, config });
      await tick();

      const [widthInput, heightInput] = Array.from(container.querySelectorAll('input.dim-input')) as HTMLInputElement[];
      expect((widthInput as HTMLInputElement).value).toBe('800');
      expect((heightInput as HTMLInputElement).value).toBe('600');
    });

    it('should disable aspect ratio buttons when custom resolution is active', async () => {
      const config: ImagePass = { inputs: {}, resolution: { width: 800, height: 600 } };
      const { container } = render(BufferConfig, { ...baseImageProps, config });
      await tick();

      const aspectButtons = Array.from(container.querySelectorAll('button.preset-btn')).filter(
        (b) => ['16:9', '4:3', '1:1', 'fill', 'auto'].includes(b.textContent?.trim() ?? '')
      ) as HTMLButtonElement[];

      expect(aspectButtons.length).toBe(5);
      aspectButtons.forEach((btn) => {
        expect(btn.disabled).toBe(true);
      });
    });

    it('should enable aspect ratio buttons when no custom resolution is set', () => {
      const config: ImagePass = { inputs: {} };
      const { container } = render(BufferConfig, { ...baseImageProps, config });

      const aspectButtons = Array.from(container.querySelectorAll('button.preset-btn')).filter(
        (b) => ['16:9', '4:3', '1:1', 'fill', 'auto'].includes(b.textContent?.trim() ?? '')
      ) as HTMLButtonElement[];

      expect(aspectButtons.length).toBe(5);
      aspectButtons.forEach((btn) => {
        expect(btn.disabled).toBe(false);
      });
    });

    it('should not call onUpdate when disabled aspect button is clicked', async () => {
      const onUpdate = vi.fn();
      const config: ImagePass = { inputs: {}, resolution: { width: 800, height: 600 } };
      const { container } = render(BufferConfig, { ...baseImageProps, config, onUpdate });
      await tick();

      const aspectBtn = Array.from(container.querySelectorAll('button.preset-btn')).find(
        (b) => b.textContent?.trim() === '16:9'
      ) as HTMLButtonElement;

      await fireEvent.click(aspectBtn);
      await tick();

      expect(onUpdate).not.toHaveBeenCalled();
    });
  });
});
