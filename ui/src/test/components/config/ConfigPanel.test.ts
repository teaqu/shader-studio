import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import ConfigPanel from '../../../lib/components/config/ConfigPanel.svelte';
import type { Transport } from '../../../lib/transport/MessageTransport';
import type { ShaderConfig } from '@shader-studio/types';
import { ConfigManager } from '../../../lib/ConfigManager';
import { BufferConfig } from '../../../lib/BufferConfig';

// Track BufferConfig constructor calls to verify config passed to child components
const bufferConfigConstructorCalls: { name: string; config: any }[] = [];
vi.mock('../../../lib/BufferConfig', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/BufferConfig')>('../../../lib/BufferConfig');
  return {
    BufferConfig: class extends actual.BufferConfig {
      constructor(name: string, config: any, onUpdate?: any) {
        super(name, config, onUpdate);
        bufferConfigConstructorCalls.push({ name, config });
      }
    },
  };
});

// Mock ConfigManager to avoid real transport interactions
vi.mock('../../../lib/ConfigManager', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    setConfig: vi.fn(),
    setPathMap: vi.fn(),
    setShaderPath: vi.fn(),
    getBufferList: vi.fn().mockReturnValue([]),
    addBuffer: vi.fn().mockReturnValue(null),
    addCommonBuffer: vi.fn().mockReturnValue(true),
    addSpecificBuffer: vi.fn().mockReturnValue(true),
    getConfig: vi.fn().mockReturnValue(null),
    removeBuffer: vi.fn(),
    updateImagePass: vi.fn(),
    updateBuffer: vi.fn(),
    updateBufferPath: vi.fn(),
    generateBufferPath: vi.fn().mockReturnValue('/test/buffer.glsl'),
    createBufferFile: vi.fn(),
    getWebviewUri: vi.fn(),
    dispose: vi.fn(),
  })),
}));

function createMockConfigManager(getBufferListReturn: string[] = []) {
  return {
    setConfig: vi.fn(),
    setPathMap: vi.fn(),
    setShaderPath: vi.fn(),
    getBufferList: vi.fn().mockReturnValue(getBufferListReturn),
    addBuffer: vi.fn().mockReturnValue(null),
    addCommonBuffer: vi.fn().mockReturnValue(true),
    addSpecificBuffer: vi.fn().mockReturnValue(true),
    getConfig: vi.fn().mockReturnValue(null),
    removeBuffer: vi.fn(),
    updateImagePass: vi.fn(),
    updateBuffer: vi.fn(),
    updateBufferPath: vi.fn(),
    generateBufferPath: vi.fn().mockReturnValue('/test/buffer.glsl'),
    createBufferFile: vi.fn(),
    getWebviewUri: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('ConfigPanel', () => {
  let mockTransport: Transport;
  let mockOnFileSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset ConfigManager mock to default (empty buffer list)
    (ConfigManager as unknown as Mock).mockImplementation(() => createMockConfigManager([]));

    mockTransport = {
      postMessage: vi.fn(),
      onMessage: vi.fn(),
      dispose: vi.fn(),
      getType: () => 'vscode' as const,
      isConnected: () => true,
    } as Transport;

    mockOnFileSelect = vi.fn();
    bufferConfigConstructorCalls.length = 0;
  });

  function getLatestConfigManagerInstance(): ReturnType<typeof createMockConfigManager> {
    const calls = (ConfigManager as unknown as Mock).mock.results;
    return calls[calls.length - 1].value;
  }

  describe('rendering', () => {
    it('should render the Image tab by default', async () => {
      const { getByText } = render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(getByText('Image')).toBeTruthy();
    });

    it('should render tab navigation', async () => {
      const { container } = render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(container.querySelector('.tab-navigation')).toBeTruthy();
    });

    it('should show add buffer button when no config', async () => {
      const { getByText } = render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(getByText('+ New')).toBeTruthy();
    });

    it('should show add buffer button when config exists', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(getByText('+ New')).toBeTruthy();
    });
  });

  describe('tab navigation', () => {
    it('should render tabs for buffers returned by getBufferList', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: '/test/common.glsl', inputs: {} },
          BufferA: { path: '/test/bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['common', 'BufferA']),
      );

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(getByText('Image')).toBeTruthy();
      expect(getByText('Common')).toBeTruthy();
      expect(getByText('BufferA')).toBeTruthy();
    });

    it('should call onFileSelect when switching tabs', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/test/bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const bufferATab = getByText('BufferA');
      await fireEvent.click(bufferATab);

      expect(mockOnFileSelect).toHaveBeenCalledWith('BufferA');
    });

    it('should call onFileSelect with "common" when clicking Common tab', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: '/test/common.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['common']),
      );

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const commonTab = getByText('Common');
      await fireEvent.click(commonTab);

      // The switchTab function converts "Common" display name to "common" actual name
      expect(mockOnFileSelect).toHaveBeenCalledWith('common');
    });

    it('should sync activeTab when selectedBuffer prop changes', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/test/bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { container, rerender } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      // Initially, Image tab should be active
      const imageTab = container.querySelector('.tab-button.active');
      expect(imageTab?.textContent).toContain('Image');

      // Update selectedBuffer to BufferA via rerender
      await rerender({
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'BufferA',
      });
      await tick();

      const activeTab = container.querySelector('.tab-button.active');
      expect(activeTab?.textContent).toContain('BufferA');
    });

    it('should convert "common" selectedBuffer to "Common" display name for active tab', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: '/test/common.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['common']),
      );

      const { container, rerender } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      // Update selectedBuffer to "common" (lowercase as used internally)
      await rerender({
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'common',
      });
      await tick();

      const activeTab = container.querySelector('.tab-button.active');
      expect(activeTab?.textContent).toContain('Common');
    });
  });

  describe('add buffer', () => {
    it('should switch to new tab after adding a buffer', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };

      const updatedConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '', inputs: {} },
        },
      };

      const mockManager = createMockConfigManager([]);
      mockManager.addBuffer.mockReturnValue('BufferA');
      mockManager.getConfig.mockReturnValue(updatedConfig);

      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);

      const { getByText, container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      // Hover over + New to show dropdown, then click Buffer
      const addNewBtn = getByText('+ New');
      await fireEvent.mouseEnter(addNewBtn.closest('.add-tab-dropdown')!);
      const bufferItem = getByText('Buffer');
      await fireEvent.click(bufferItem);
      await tick();

      expect(mockManager.addBuffer).toHaveBeenCalled();
      expect(mockOnFileSelect).toHaveBeenCalledWith('BufferA');
    });

    it('should switch to Common tab after adding common buffer', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };

      const updatedConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: '' },
        },
      };

      const mockManager = createMockConfigManager([]);
      mockManager.addCommonBuffer.mockReturnValue(true);
      mockManager.getConfig.mockReturnValue(updatedConfig);

      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const addNewBtn = getByText('+ New');
      await fireEvent.mouseEnter(addNewBtn.closest('.add-tab-dropdown')!);
      const commonItem = getByText('Common');
      await fireEvent.click(commonItem);
      await tick();

      expect(mockManager.addCommonBuffer).toHaveBeenCalled();
      expect(mockOnFileSelect).toHaveBeenCalledWith('common');
    });
  });

  describe('double-click sends navigateToBuffer', () => {
    it('should send navigateToBuffer on double-click when locked and buffer has path', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };
      const bufferPathMap = { Image: '/path/shader.glsl', BufferA: '/path/bufferA.glsl' };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap,
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: true,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      expect(bufferATab).toBeTruthy();
      await fireEvent.dblClick(bufferATab!);

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'navigateToBuffer',
        payload: {
          bufferPath: '/path/bufferA.glsl',
          shaderPath: '/path/shader.glsl',
        }
      });
    });

    it('should NOT send navigateToBuffer on single click', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };
      const bufferPathMap = { Image: '/path/shader.glsl', BufferA: '/path/bufferA.glsl' };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap,
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: true,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      await fireEvent.click(bufferATab!);

      // Single click should call onFileSelect, not postMessage for navigateToBuffer
      expect(mockTransport.postMessage).not.toHaveBeenCalled();
    });

    it('should NOT send navigateToBuffer on double-click when not locked', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };
      const bufferPathMap = { Image: '/path/shader.glsl', BufferA: '/path/bufferA.glsl' };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap,
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: false,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      await fireEvent.dblClick(bufferATab!);

      expect(mockTransport.postMessage).not.toHaveBeenCalled();
    });

    it('should NOT send navigateToBuffer on double-click when buffer has no path', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };
      const bufferPathMap = { Image: '/path/shader.glsl' }; // No BufferA path

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap,
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: true,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      await fireEvent.dblClick(bufferATab!);

      expect(mockTransport.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('ConfigManager initialization', () => {
    it('should create ConfigManager with transport on mount', async () => {
      render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(ConfigManager).toHaveBeenCalledWith(mockTransport, expect.any(Function));
    });

    it('should call setConfig on ConfigManager when config prop is provided', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };

      render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const instance = getLatestConfigManagerInstance();
      expect(instance.setConfig).toHaveBeenCalledWith(config);
    });

    it('should call setPathMap on ConfigManager when pathMap prop is provided', async () => {
      const pathMap = { '/test/shader.glsl': 'webview-uri://shader.glsl' };

      render(ConfigPanel, {
        config: null,
        pathMap,
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const instance = getLatestConfigManagerInstance();
      expect(instance.setPathMap).toHaveBeenCalledWith(pathMap);
    });

    it('should call setShaderPath on ConfigManager when shaderPath prop is provided', async () => {
      render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const instance = getLatestConfigManagerInstance();
      expect(instance.setShaderPath).toHaveBeenCalledWith('/test/shader.glsl');
    });
  });

  describe('remove buffer', () => {
    it('should show close button on non-Image tabs when config exists', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/test/bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const closeButtons = container.querySelectorAll('.tab-close');
      expect(closeButtons.length).toBe(1);
    });

    it('should not show close button on Image-only config', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };

      // Ensure default mock returns empty buffer list (only Image tab shown)
      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager([]),
      );

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const closeButtons = container.querySelectorAll('.tab-close');
      expect(closeButtons.length).toBe(0);
    });

    it('should call removeBuffer on ConfigManager when close button is clicked', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/test/bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const closeButton = container.querySelector('.tab-close');
      expect(closeButton).toBeTruthy();

      await fireEvent.click(closeButton!);

      const instance = getLatestConfigManagerInstance();
      expect(instance.removeBuffer).toHaveBeenCalledWith('BufferA');
    });

    it('should call removeBuffer when closing a non-active tab', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/test/bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      // Image should be active
      const activeTab = container.querySelector('.tab-button.active');
      expect(activeTab?.textContent).toContain('Image');

      // Click the close button on BufferA tab (not the active tab)
      const closeButton = container.querySelector('.tab-close');
      await fireEvent.click(closeButton!);

      const instance = getLatestConfigManagerInstance();
      expect(instance.removeBuffer).toHaveBeenCalledWith('BufferA');

      // Image should remain active since we removed a non-active tab
      const stillActiveTab = container.querySelector('.tab-button.active');
      expect(stillActiveTab?.textContent).toContain('Image');
    });
  });

  describe('Image pass fallback config', () => {
    it('should not include path property in Image pass fallback when config is null', async () => {
      render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      // BufferConfig.svelte creates a BufferConfig instance with the activeTabConfig.
      // When config is null, the fallback for Image should be { inputs: {} } with no path.
      const imageCall = bufferConfigConstructorCalls.find((c) => c.name === 'Image');
      expect(imageCall).toBeTruthy();
      expect(imageCall!.config).toEqual({ inputs: {} });
      expect('path' in imageCall!.config).toBe(false);
    });

    it('should not include path property in Image pass fallback when config has no Image pass', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };
      // Remove Image pass after creation to bypass type check
      delete (config.passes as any).Image;

      render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const imageCall = bufferConfigConstructorCalls.find((c) => c.name === 'Image');
      expect(imageCall).toBeTruthy();
      expect(imageCall!.config).toEqual({ inputs: {} });
      expect('path' in imageCall!.config).toBe(false);
    });
  });

  describe('audio/video controller prop', () => {
    function createMockAudioVideoController() {
      return {
        videoControl: vi.fn(),
        getVideoState: vi.fn().mockReturnValue(null),
        audioControl: vi.fn(),
        getAudioState: vi.fn().mockReturnValue(null),
        getAudioFFT: vi.fn().mockReturnValue(null),
        setVolume: vi.fn(),
        toggleMute: vi.fn(),
        volume: 1.0,
        muted: false,
        dispose: vi.fn(),
      } as any;
    }

    it('should accept audioVideoController with video inputs', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: 'video', path: '/test/video.mp4' }
            }
          },
        },
      };

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        audioVideoController: createMockAudioVideoController(),
      });

      await tick();

      expect(container.querySelector('.config-panel')).toBeTruthy();
    });

    it('should accept audioVideoController with audio inputs', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: 'audio', path: '/test/audio.mp3' }
            }
          },
        },
      };

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        audioVideoController: createMockAudioVideoController(),
      });

      await tick();

      expect(container.querySelector('.config-panel')).toBeTruthy();
    });

    it('should accept globalMuted prop', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
        },
      };

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        globalMuted: true,
      });

      await tick();

      expect(container.querySelector('.config-panel')).toBeTruthy();
    });

    it('should render with audioVideoController and mixed inputs', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: 'video', path: '/test/video.mp4' },
              iChannel1: { type: 'audio', path: '/test/audio.mp3' },
            }
          },
        },
      };

      const { container } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        audioVideoController: createMockAudioVideoController(),
        globalMuted: false,
      });

      await tick();

      expect(container.querySelector('.config-panel')).toBeTruthy();
      expect(container.querySelector('.tab-navigation')).toBeTruthy();
    });
  });

  describe('visibility', () => {
    it('should apply visible class when isVisible is true', async () => {
      const { container } = render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const panel = container.querySelector('.config-panel');
      expect(panel?.classList.contains('visible')).toBe(true);
    });

    it('should not apply visible class when isVisible is false', async () => {
      const { container } = render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: false,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const panel = container.querySelector('.config-panel');
      expect(panel?.classList.contains('visible')).toBe(false);
    });
  });
});
