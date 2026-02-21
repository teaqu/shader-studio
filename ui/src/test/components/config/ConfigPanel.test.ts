import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import ConfigPanel from '../../../lib/components/config/ConfigPanel.svelte';
import type { Transport } from '../../../lib/transport/MessageTransport';
import type { ShaderConfig } from '@shader-studio/types';
import { ConfigManager } from '../../../lib/ConfigManager';

// Mock ConfigManager to avoid real transport interactions
vi.mock('../../../lib/ConfigManager', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    setConfig: vi.fn(),
    setPathMap: vi.fn(),
    setShaderPath: vi.fn(),
    getBufferList: vi.fn().mockReturnValue([]),
    addCommonBuffer: vi.fn().mockReturnValue(true),
    addSpecificBuffer: vi.fn().mockReturnValue(true),
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
    addCommonBuffer: vi.fn().mockReturnValue(true),
    addSpecificBuffer: vi.fn().mockReturnValue(true),
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
  });

  function getLatestConfigManagerInstance(): ReturnType<typeof vi.fn> {
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

    it('should show Add Buffer button when no config', async () => {
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

      expect(getByText('Add Buffer')).toBeTruthy();
    });

    it('should show Add Buffer button when buffers are available to add', async () => {
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

      expect(getByText('Add Buffer')).toBeTruthy();
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
