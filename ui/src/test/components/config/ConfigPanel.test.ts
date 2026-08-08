import { render, fireEvent } from '@testing-library/svelte';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tick } from 'svelte';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import ConfigPanel from '../../../lib/components/config/ConfigPanel.svelte';
import type { Transport } from '../../../lib/transport/MessageTransport';
import type { ShaderConfig } from '@shader-studio/types';
import { ConfigManager } from '../../../lib/ConfigManager';
import {
  getOverlayActiveFile,
  setEditorOverlayVisible,
  setOverlayActiveFile,
} from '../../../lib/state/editorOverlayState.svelte';
// Mock ConfigManager to avoid real transport interactions
vi.mock('../../../lib/ConfigManager', () => ({
  ConfigManager: vi.fn().mockImplementation(() => ({
    setConfig: vi.fn(),
    setPathMap: vi.fn(),
    setShaderPath: vi.fn(),
    getBufferList: vi.fn().mockReturnValue([]),
    addBuffer: vi.fn().mockReturnValue(null),
    addComputePass: vi.fn().mockReturnValue(null),
    addCommonBuffer: vi.fn().mockReturnValue(true),
    addSpecificBuffer: vi.fn().mockReturnValue(true),
    getConfig: vi.fn().mockReturnValue(null),
    removeBuffer: vi.fn(),
    updateImagePass: vi.fn(),
    updateBuffer: vi.fn(),
    updateComputePass: vi.fn().mockReturnValue({ ok: true }),
    addStorageBuffer: vi.fn().mockReturnValue({ name: 'storageA' }),
    applyStorageBuffer: vi.fn().mockReturnValue({ ok: true }),
    removeStorageBuffer: vi.fn().mockReturnValue({ ok: true }),
    getStorageCoverReferences: vi.fn().mockReturnValue([]),
    updateBufferPath: vi.fn(),
    setScript: vi.fn(),
    removeScript: vi.fn(),
    generateBufferPath: vi.fn().mockReturnValue('/test/buffer.glsl'),
    generateScriptPath: vi.fn().mockReturnValue('./shader.uniforms.ts'),
    createBufferFile: vi.fn(),
    getWebviewUri: vi.fn(),
    validateBufferRename: vi.fn().mockReturnValue(null),
    renameBuffer: vi.fn().mockReturnValue(true),
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
    addComputePass: vi.fn().mockReturnValue(null),
    addCommonBuffer: vi.fn().mockReturnValue(true),
    addSpecificBuffer: vi.fn().mockReturnValue(true),
    getConfig: vi.fn().mockReturnValue(null),
    removeBuffer: vi.fn(),
    updateImagePass: vi.fn(),
    updateBuffer: vi.fn(),
    updateComputePass: vi.fn().mockReturnValue({ ok: true }),
    addStorageBuffer: vi.fn().mockReturnValue({ name: 'storageA' }),
    applyStorageBuffer: vi.fn().mockReturnValue({ ok: true }),
    removeStorageBuffer: vi.fn().mockReturnValue({ ok: true }),
    getStorageCoverReferences: vi.fn().mockReturnValue([]),
    updateBufferPath: vi.fn(),
    setScript: vi.fn(),
    removeScript: vi.fn(),
    generateBufferPath: vi.fn().mockReturnValue('/test/buffer.glsl'),
    generateScriptPath: vi.fn().mockReturnValue('./shader.uniforms.ts'),
    createBufferFile: vi.fn(),
    getWebviewUri: vi.fn(),
    validateBufferRename: vi.fn().mockReturnValue(null),
    renameBuffer: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
  };
}

describe('ConfigPanel', () => {
  let mockTransport: Transport;
  let mockOnFileSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setEditorOverlayVisible(false);
    setOverlayActiveFile('Image');

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
    it('renders configured compute passes as tabs', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          ComputeSim: { type: 'compute', path: 'sim.slang', inputs: {} },
        },
      };

      const { getByRole } = render(ConfigPanel, {
        config,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(getByRole('button', { name: /^ComputeSim/ })).toBeInTheDocument();
    });

    it('renders the Storage tab for Slang configurations', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        storage: { particles: { count: 1024, stride: 16, elementType: 'float4' } },
        passes: { Image: { inputs: {} } },
      };

      const { getByRole } = render(ConfigPanel, {
        config,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();
      await fireEvent.click(getByRole('button', { name: 'Storage' }));

      expect(getByRole('heading', { name: 'Storage' })).toBeInTheDocument();
      expect(mockOnFileSelect).not.toHaveBeenCalled();
    });

    it('reacts when a compute pass is added to the config prop', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: { Image: { inputs: {} } },
      };
      const props = {
        config,
        language: 'glsl' as const,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      };
      const { queryByRole, rerender } = render(ConfigPanel, props);

      await tick();
      expect(queryByRole('button', { name: /^ComputeSim/ })).not.toBeInTheDocument();

      await rerender({
        ...props,
        config: {
          ...config,
          passes: {
            ...config.passes,
            ComputeSim: { type: 'compute', path: 'sim.slang', inputs: {} },
          },
        },
      });
      await tick();

      expect(queryByRole('button', { name: /^ComputeSim/ })).toBeInTheDocument();
      expect(queryByRole('button', { name: /add compute/i })).not.toBeInTheDocument();
    });

    it('should render tabs for buffers returned by getBufferList', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: '/test/common.glsl' },
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
          common: { path: '/test/common.glsl' },
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
          common: { path: '/test/common.glsl' },
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

  describe('tab ordering', () => {
    function tabLabels(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('.tab-button'))
        .map(el => el.textContent?.replace('×', '').trim() ?? '');
    }

    it('buffer tabs are sorted alphabetically', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferC: { path: '', inputs: {} },
          BufferA: { path: '', inputs: {} },
          BufferB: { path: '', inputs: {} },
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
      });

      await tick();

      const labels = tabLabels(container).filter(l => l.startsWith('Buffer'));
      expect(labels).toEqual(['BufferA', 'BufferB', 'BufferC']);
    });

    it('Common tab appears after Image and before buffers', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '', inputs: {} },
          common: { path: '' },
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
      });

      await tick();

      const labels = tabLabels(container).filter(l => l !== '+ New');
      const imageIdx = labels.indexOf('Image');
      const commonIdx = labels.indexOf('Common');
      const bufferAIdx = labels.indexOf('BufferA');
      expect(imageIdx).toBeLessThan(commonIdx);
      expect(commonIdx).toBeLessThan(bufferAIdx);
    });

    it('Script tab appears last', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '', inputs: {} },
          common: { path: '' },
        },
        script: './shader.uniforms.ts',
      } as any;

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

      const labels = tabLabels(container).filter(l => l !== '+ New');
      expect(labels[labels.length - 1]).toBe('Script');
    });

    it('BufferE appears in tabs when it exists in config', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '', inputs: {} },
          BufferE: { path: '', inputs: {} },
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
      });

      await tick();

      const labels = tabLabels(container);
      expect(labels).toContain('BufferE');
    });

    it('BufferE sorts after BufferD in tab order', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferE: { path: '', inputs: {} },
          BufferA: { path: '', inputs: {} },
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
      });

      await tick();

      const labels = tabLabels(container).filter(l => l.startsWith('Buffer'));
      const aIdx = labels.indexOf('BufferA');
      const eIdx = labels.indexOf('BufferE');
      expect(aIdx).toBeLessThan(eIdx);
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

  describe('add compute pass', () => {
    const config: ShaderConfig = {
      version: '1.0',
      passes: { Image: { inputs: {} } },
    };

    function renderPanel(language: 'glsl' | 'slang') {
      return render(ConfigPanel, {
        config,
        language,
        pathMap: {},
        transport: mockTransport,
        shaderPath: `/test/image.${language}`,
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });
    }

    it('shows the add-compute affordance for Slang', async () => {
      const { getByRole, getByText, queryByText } = renderPanel('slang');

      await tick();
      await fireEvent.click(getByRole('button', { name: '+ New' }));

      expect(getByRole('menuitem', { name: /add compute/i })).toBeInTheDocument();
      expect(getByText('Compute')).toBeInTheDocument();
      expect(queryByText('+ Compute')).not.toBeInTheDocument();
    });

    it('hides the add-compute affordance for GLSL', async () => {
      const { getByRole, queryByRole } = renderPanel('glsl');

      await tick();
      await fireEvent.click(getByRole('button', { name: '+ New' }));

      expect(queryByRole('button', { name: /add compute/i })).not.toBeInTheDocument();
    });

    it('reacts to active language changes without altering existing add options', async () => {
      const props = {
        config,
        language: 'glsl' as 'glsl' | 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      };
      const { getByRole, queryByRole, rerender } = render(ConfigPanel, props);

      await tick();
      await fireEvent.click(getByRole('button', { name: '+ New' }));
      expect(queryByRole('menuitem', { name: /add compute/i })).not.toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Buffer' })).toBeInTheDocument();

      await rerender({ ...props, language: 'slang' });
      await tick();
      expect(getByRole('menuitem', { name: /add compute/i })).toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Buffer' })).toBeInTheDocument();

      await rerender(props);
      await tick();
      expect(queryByRole('menuitem', { name: /add compute/i })).not.toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Buffer' })).toBeInTheDocument();
    });

    it('adds, publishes, and selects a compute pass', async () => {
      const updatedConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          ComputeA: { type: 'compute', path: '', inputs: {} },
        },
      };
      const mockManager = createMockConfigManager([]);
      mockManager.getConfig.mockReturnValue(updatedConfig);
      (ConfigManager as unknown as Mock).mockImplementation(
        (_transport: Transport, handleConfigChange: (config: ShaderConfig) => void) => {
          mockManager.addComputePass.mockImplementation(() => {
            handleConfigChange(updatedConfig);
            return 'ComputeA';
          });
          return mockManager;
        },
      );
      const onConfigChange = vi.fn();

      const { getByRole } = render(ConfigPanel, {
        config,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onConfigChange,
      });
      await tick();

      await fireEvent.click(getByRole('button', { name: '+ New' }));
      await fireEvent.click(getByRole('menuitem', { name: /add compute/i }));
      await tick();

      expect(mockManager.addComputePass).toHaveBeenCalledOnce();
      expect(onConfigChange).toHaveBeenCalledWith(updatedConfig);
      expect(mockOnFileSelect).toHaveBeenCalledWith('ComputeA');
      expect(getByRole('button', { name: /^ComputeA/ })).toHaveClass('active');
    });

    it('routes Compute tab source creation through the Slang compute file workflow', async () => {
      const computeConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          ComputeA: { type: 'compute', path: '', inputs: {} },
        },
      };
      const mockManager = createMockConfigManager([]);
      mockManager.generateBufferPath.mockReturnValue('image.computea.slang');
      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);

      const { getAllByText } = render(ConfigPanel, {
        config: computeConfig,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'ComputeA',
      });
      await tick();

      await fireEvent.click(getAllByText('Create')[0]);

      expect(mockManager.generateBufferPath).toHaveBeenCalledWith('ComputeA', 'slang');
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'createFile',
        payload: {
          shaderPath: '/test/image.slang',
          suggestedPath: 'image.computea.slang',
          fileType: 'slang-compute',
          requestId: expect.any(String),
        },
      });
    });

    it('does nothing when the manager cannot add a compute pass', async () => {
      const mockManager = createMockConfigManager([]);
      mockManager.addComputePass.mockReturnValue(null);
      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);
      const onConfigChange = vi.fn();

      const { getByRole } = render(ConfigPanel, {
        config,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onConfigChange,
      });
      await tick();

      await fireEvent.click(getByRole('button', { name: '+ New' }));
      await fireEvent.click(getByRole('menuitem', { name: /add compute/i }));
      await tick();

      expect(mockManager.addComputePass).toHaveBeenCalledOnce();
      expect(mockManager.getConfig).not.toHaveBeenCalled();
      expect(onConfigChange).not.toHaveBeenCalled();
      expect(mockOnFileSelect).not.toHaveBeenCalled();
      expect(getByRole('button', { name: 'Image' })).toHaveClass('active');
    });

    it('selects the returned pass without publishing when the manager has no config', async () => {
      const mockManager = createMockConfigManager([]);
      mockManager.addComputePass.mockReturnValue('ComputeA');
      mockManager.getConfig.mockReturnValue(null);
      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);
      const onConfigChange = vi.fn();

      const { getByRole } = render(ConfigPanel, {
        config,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onConfigChange,
      });
      await tick();

      await fireEvent.click(getByRole('button', { name: '+ New' }));
      await fireEvent.click(getByRole('menuitem', { name: /add compute/i }));
      await tick();

      expect(mockManager.addComputePass).toHaveBeenCalledOnce();
      expect(mockManager.getConfig).toHaveBeenCalledOnce();
      expect(onConfigChange).not.toHaveBeenCalled();
      expect(mockOnFileSelect).toHaveBeenCalledOnce();
      expect(mockOnFileSelect).toHaveBeenCalledWith('ComputeA');
      expect(getByRole('button', { name: 'Image' })).not.toHaveClass('active');
    });
  });

  describe('add pass menu accessibility', () => {
    function renderSlangPanel() {
      return render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: { Image: { inputs: {} } },
        },
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });
    }

    it('opens with ArrowDown, navigates to Compute, and closes with Escape', async () => {
      const { getByRole, queryByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });

      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveAttribute('aria-controls', 'add-pass-menu');
      expect(queryByRole('menu')).not.toBeInTheDocument();

      trigger.focus();
      await fireEvent.keyDown(trigger, { key: 'ArrowDown' });

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(getByRole('menu')).toBeInTheDocument();
      const bufferItem = getByRole('menuitem', { name: 'Buffer' });
      const computeItem = getByRole('menuitem', { name: /add compute/i });
      expect(bufferItem).toHaveFocus();

      await fireEvent.keyDown(bufferItem, { key: 'ArrowDown' });
      expect(computeItem).toHaveFocus();

      await fireEvent.keyDown(computeItem, { key: 'Escape' });
      expect(queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();
    });

    it('opens on hover and closes when the pointer leaves', async () => {
      const { getByRole, queryByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });
      const dropdown = trigger.closest('.add-tab-dropdown')!;

      await fireEvent.mouseEnter(dropdown);
      expect(getByRole('menu')).toBeInTheDocument();

      await fireEvent.mouseLeave(dropdown);
      expect(queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes an unpinned hover menu on mouseleave when the trigger was already focused', async () => {
      const { getByRole, queryByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });
      const dropdown = trigger.closest('.add-tab-dropdown')!;

      trigger.focus();
      await fireEvent.mouseEnter(dropdown);
      expect(getByRole('menu')).toBeInTheDocument();

      await fireEvent.mouseLeave(dropdown);
      expect(queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps a click-pinned menu open on mouseleave without relying on trigger focus', async () => {
      const { getByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });
      const dropdown = trigger.closest('.add-tab-dropdown')!;

      expect(trigger).not.toHaveFocus();
      await fireEvent.click(trigger);
      expect(trigger).not.toHaveFocus();

      await fireEvent.mouseLeave(dropdown);
      expect(getByRole('menu')).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('keeps an unpinned hover menu usable when a menuitem has keyboard focus', async () => {
      const { getByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });
      const dropdown = trigger.closest('.add-tab-dropdown')!;

      await fireEvent.mouseEnter(dropdown);
      const bufferItem = getByRole('menuitem', { name: 'Buffer' });
      bufferItem.focus();

      await fireEvent.mouseLeave(dropdown);
      expect(getByRole('menu')).toBeInTheDocument();
      expect(bufferItem).toHaveFocus();
    });

    it('closes when clicking outside', async () => {
      const { getByRole, queryByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });

      await fireEvent.click(trigger);
      expect(getByRole('menu')).toBeInTheDocument();

      await fireEvent.click(document.body);
      expect(queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggles closed when the trigger is clicked again', async () => {
      const { getByRole, queryByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });

      await fireEvent.click(trigger);
      expect(getByRole('menu')).toBeInTheDocument();

      await fireEvent.click(trigger);
      expect(queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();
    });

    it('restores focus to the trigger after activating a menu item', async () => {
      const { getByRole, queryByRole } = renderSlangPanel();
      await tick();
      const trigger = getByRole('button', { name: '+ New' });

      await fireEvent.click(trigger);
      const bufferItem = getByRole('menuitem', { name: 'Buffer' });
      bufferItem.focus();
      expect(bufferItem).toHaveFocus();

      await fireEvent.click(bufferItem);
      await tick();

      expect(queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('uses the theme focus border for a visible keyboard focus indicator', () => {
      const workspaceCssPath = resolve(process.cwd(), 'ui/src/app.css');
      const appCssPath = existsSync(workspaceCssPath)
        ? workspaceCssPath
        : resolve(process.cwd(), 'src/app.css');
      const appStyles = readFileSync(appCssPath, 'utf8');
      const focusVisibleRule = appStyles.match(/\.add-tab-btn:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';

      expect(focusVisibleRule).toMatch(/outline:\s*(?!none)/);
      expect(focusVisibleRule).toContain('var(--vscode-focusBorder)');
    });
  });

  describe('buffer rename context menu', () => {
    function getTab(container: HTMLElement, tabName: string): HTMLButtonElement {
      const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button')).find(
        (candidate) => candidate.querySelector('.tab-label')?.textContent === tabName,
      );
      if (!tab) {
        throw new Error(`Missing ${tabName} tab`);
      }
      return tab;
    }

    function renderRenameableBuffers() {
      return render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: {
            Image: { inputs: {} },
            common: { path: '/test/common.glsl' },
            BufferA: { path: '/test/bufferA.glsl', inputs: {} },
          },
          script: './shader.uniforms.ts',
        },
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });
    }

    it('opens a Rename menu at the pointer without selecting an inactive buffer tab', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();

      const bufferTab = getTab(container, 'BufferA');
      await fireEvent.contextMenu(bufferTab, { clientX: 120, clientY: 240 });
      await tick();

      const menu = getByRole('menu');
      const openItem = getByRole('menuitem', { name: 'Open' });
      expect(menu).toHaveStyle({ left: '120px', top: '240px' });
      expect(openItem).toBe(document.activeElement);
      expect(mockOnFileSelect).not.toHaveBeenCalled();
    });

    it('portals the Rename menu outside the clipped config panel', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();

      await fireEvent.contextMenu(getTab(container, 'BufferA'), { clientX: 120, clientY: 240 });
      await tick();

      const menu = getByRole('menu');
      expect(container).not.toContainElement(menu);
      expect(menu.parentElement).toBe(document.body);
    });

    it('clamps the Rename menu inside the viewport near its bottom-right edge', async () => {
      const originalBounds = HTMLElement.prototype.getBoundingClientRect;
      const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
      const heightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
      const boundsSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        function getBounds(this: HTMLElement): DOMRect {
          if (this.classList.contains('buffer-rename-menu')) {
            return {
              x: 0,
              y: 0,
              width: 40,
              height: 30,
              top: 0,
              right: 40,
              bottom: 30,
              left: 0,
              toJSON: () => ({}),
            } as DOMRect;
          }
          return originalBounds.call(this);
        },
      );

      try {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 100 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });
        const { container, getByRole } = renderRenameableBuffers();
        await tick();

        await fireEvent.contextMenu(getTab(container, 'BufferA'), { clientX: 95, clientY: 90 });
        await tick();

        expect(getByRole('menu')).toHaveStyle({ left: '60px', top: '70px' });
      } finally {
        boundsSpy.mockRestore();
        if (widthDescriptor) {
          Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
        if (heightDescriptor) {
          Object.defineProperty(window, 'innerHeight', heightDescriptor);
        }
      }
    });

    it.each(['Image', 'Common', 'Script'])('shows Open but not Rename for %s', async (tabName) => {
      const { container, getByRole, queryByRole } = renderRenameableBuffers();
      await tick();

      await fireEvent.contextMenu(getTab(container, tabName));
      await tick();

      expect(getByRole('menu')).toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
      expect(queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    });

    it.each([
      ['Shift+F10', { key: 'F10', shiftKey: true }],
      ['ContextMenu', { key: 'ContextMenu' }],
    ])('opens context menu with %s', async (_shortcut, init) => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();

      await fireEvent.keyDown(getTab(container, 'BufferA'), init);
      await tick();

      expect(getByRole('menuitem', { name: 'Open' })).toBe(document.activeElement);
    });

    it('starts an inline rename shell for only the selected buffer', async () => {
      const { container, getByRole, queryByRole } = renderRenameableBuffers();
      await tick();
      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await tick();

      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();

      const input = getByRole('textbox', { name: 'Rename BufferA' }) as HTMLInputElement;
      expect(input.value).toBe('BufferA');
      expect(input).toBe(document.activeElement);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('BufferA'.length);
      const tabLabels = Array.from(container.querySelectorAll('.tab-button .tab-label')).map(
        (label) => label.textContent,
      );
      expect(tabLabels).not.toContain('BufferA');
      expect(tabLabels).toEqual(expect.arrayContaining(['Image', 'Common', 'Script']));
      expect(queryByRole('button', { name: 'Remove BufferA' })).toBeNull();
      expect(container.querySelector('.tab-rename')).not.toHaveClass('active');
    });

    it('commits a trimmed active buffer rename with Enter and selects the renamed tab', async () => {
      const renamedConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          common: { path: '/test/common.glsl' },
          BufferRenamed: { path: '/test/bufferA.glsl', inputs: {} },
        },
        script: './shader.uniforms.ts',
      };
      const mockManager = createMockConfigManager([]);
      mockManager.renameBuffer.mockImplementation(() => {
        const constructorCall = (ConfigManager as unknown as Mock).mock.calls.at(-1);
        const onConfigChange = constructorCall?.[1] as ((config: ShaderConfig) => void) | undefined;
        onConfigChange?.(renamedConfig);
        return true;
      });
      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);

      const { container, getByRole } = render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: {
            Image: { inputs: {} },
            common: { path: '/test/common.glsl' },
            BufferA: { path: '/test/bufferA.glsl', inputs: {} },
          },
          script: './shader.uniforms.ts',
        },
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'BufferA',
      });
      await tick();

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: '  BufferRenamed  ' } });
      const windowKeyDown = vi.fn();
      window.addEventListener('keydown', windowKeyDown);
      try {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(windowKeyDown).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('keydown', windowKeyDown);
      }
      await tick();
      await tick();

      expect(mockManager.validateBufferRename).toHaveBeenCalledWith('BufferA', 'BufferRenamed');
      expect(mockManager.renameBuffer).toHaveBeenCalledWith('BufferA', 'BufferRenamed');
      expect(mockOnFileSelect).toHaveBeenCalledWith('BufferRenamed');
      const renamedTab = getTab(container, 'BufferRenamed');
      expect(renamedTab).toHaveClass('active');
      expect(renamedTab).toBe(document.activeElement);
    });

    it('commits an inactive buffer rename on blur without changing the active selection', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: 'BufferBlurred' } });
      await fireEvent.blur(input);
      await tick();

      expect(mockManager.validateBufferRename).toHaveBeenCalledWith('BufferA', 'BufferBlurred');
      expect(mockManager.renameBuffer).toHaveBeenCalledWith('BufferA', 'BufferBlurred');
      expect(mockOnFileSelect).not.toHaveBeenCalled();
      expect(getTab(container, 'Image')).toHaveClass('active');
    });

    it('cancels an inline rename with Escape without calling the manager', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();
      const windowKeyDown = vi.fn();
      window.addEventListener('keydown', windowKeyDown);

      try {
        await fireEvent.contextMenu(getTab(container, 'BufferA'));
        await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
        await tick();
        const input = getByRole('textbox', { name: 'Rename BufferA' });
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });

        input.dispatchEvent(event);
        await tick();
        await tick();

        expect(event.defaultPrevented).toBe(true);
        expect(windowKeyDown).not.toHaveBeenCalled();
        expect(mockManager.validateBufferRename).not.toHaveBeenCalled();
        expect(mockManager.renameBuffer).not.toHaveBeenCalled();
        expect(getTab(container, 'BufferA')).toBe(document.activeElement);
      } finally {
        window.removeEventListener('keydown', windowKeyDown);
      }
    });

    it('does not remove, select, or navigate while cancelling an edited rename draft', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();

      const input = getByRole('textbox', { name: 'Rename BufferA' });
      await fireEvent.input(input, { target: { value: 'BufferDraft' } });
      await fireEvent.keyDown(input, { key: 'Escape' });
      await tick();

      expect(mockManager.removeBuffer).not.toHaveBeenCalled();
      expect(mockOnFileSelect).not.toHaveBeenCalled();
      expect(mockTransport.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'navigateToBuffer' }),
      );
      expect(getTab(container, 'BufferA')).toBe(document.activeElement);
    });

    it.each([
      ['empty', ''],
      ['whitespace', '   '],
      ['unchanged', 'BufferA'],
    ])('cancels a %s rename draft without validation', async (_name, draft) => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: draft } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await tick();

      expect(mockManager.validateBufferRename).not.toHaveBeenCalled();
      expect(mockManager.renameBuffer).not.toHaveBeenCalled();
      expect(getTab(container, 'BufferA')).toBe(document.activeElement);
    });

    it.each(['Common', 'Script'])('does not commit a UI-reserved %s rename target', async (newName) => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();
      mockManager.validateBufferRename.mockImplementation((_oldName: string, proposedName: string) =>
        proposedName === newName ? 'reserved-name' : null,
      );

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: newName } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await tick();

      expect(mockManager.validateBufferRename).toHaveBeenCalledWith('BufferA', newName);
      expect(mockManager.renameBuffer).not.toHaveBeenCalled();
      expect(getByRole('alert')).toHaveTextContent('That pass name is reserved');
    });

    it.each([
      ['invalid-identifier', 'Enter a valid pass name'],
      ['reserved-name', 'That pass name is reserved'],
      ['name-taken', 'That pass name is already in use'],
      ['config-unavailable', 'Configuration is unavailable'],
      ['source-not-found', 'This pass no longer exists'],
      ['same-name', 'Name is unchanged'],
    ])('shows an accessible, editable %s rename error', async (validationError, message) => {
      const { container, getByRole, queryByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();
      mockManager.validateBufferRename.mockReturnValue(validationError);

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: 'BufferRenamed' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await tick();

      const alert = getByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAttribute('aria-describedby', alert.id);
      expect(mockManager.renameBuffer).not.toHaveBeenCalled();

      await fireEvent.input(input, { target: { value: 'BufferRetried' } });
      await tick();

      expect(input).toHaveValue('BufferRetried');
      expect(queryByRole('alert')).toBeNull();
      expect(input).not.toHaveAttribute('aria-invalid');
      expect(input).not.toHaveAttribute('aria-describedby');
    });

    it('keeps the editor open when renameBuffer unexpectedly fails after validation', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();
      mockManager.renameBuffer.mockReturnValue(false);

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: 'BufferRenamed' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await tick();

      expect(mockManager.validateBufferRename).toHaveBeenCalledWith('BufferA', 'BufferRenamed');
      expect(mockManager.renameBuffer).toHaveBeenCalledWith('BufferA', 'BufferRenamed');
      expect(getByRole('textbox', { name: 'Rename BufferA' })).toBe(input);
      expect(getByRole('alert')).toHaveTextContent('Unable to rename this pass');
      expect(mockOnFileSelect).not.toHaveBeenCalled();
      expect(getTab(container, 'Image')).toHaveClass('active');
    });

    it('does not commit twice when Enter is followed by blur', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();
      const mockManager = getLatestConfigManagerInstance();

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await fireEvent.click(getByRole('menuitem', { name: 'Rename' }));
      await tick();
      const input = getByRole('textbox', { name: 'Rename BufferA' });

      await fireEvent.input(input, { target: { value: 'BufferRenamed' } });
      await fireEvent.keyDown(input, { key: 'Enter' });
      await fireEvent.blur(input);
      await tick();

      expect(mockManager.validateBufferRename).toHaveBeenCalledTimes(1);
      expect(mockManager.renameBuffer).toHaveBeenCalledTimes(1);
    });

    it('dismisses the menu on outside click', async () => {
      const { container, queryByRole } = renderRenameableBuffers();
      await tick();
      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await tick();

      await fireEvent.click(container.querySelector('.tab-content')!);
      expect(queryByRole('menu')).toBeNull();
    });

    it('dismisses the menu with Escape and restores the triggering tab focus', async () => {
      const { container, queryByRole } = renderRenameableBuffers();
      await tick();
      const bufferTab = getTab(container, 'BufferA');
      await fireEvent.contextMenu(bufferTab);
      await tick();

      await fireEvent.keyDown(window, { key: 'Escape' });
      await tick();

      expect(queryByRole('menu')).toBeNull();
      expect(bufferTab).toBe(document.activeElement);
    });

    it('dismisses the menu when focus leaves without restoring the triggering tab focus', async () => {
      const { container, getByRole, queryByRole } = renderRenameableBuffers();
      await tick();
      const bufferTab = getTab(container, 'BufferA');
      const imageTab = getTab(container, 'Image');
      await fireEvent.contextMenu(bufferTab);
      await tick();
      expect(getByRole('menuitem', { name: 'Open' })).toBe(document.activeElement);

      imageTab.focus();
      await tick();

      expect(queryByRole('menu')).toBeNull();
      expect(imageTab).toBe(document.activeElement);
    });

    it('replaces the context menu when right-clicking a different menuable tab', async () => {
      const { container, queryByRole } = renderRenameableBuffers();
      await tick();

      // Right-click BufferA to open its menu
      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await tick();
      expect(queryByRole('menu')).toBeTruthy();

      // Right-click Image — should close the first menu and open a new one
      await fireEvent.contextMenu(getTab(container, 'Image'));
      await tick();
      expect(queryByRole('menu')).toBeTruthy();
      expect(queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    });

    it('shows Open and Rename for buffer pass tabs', async () => {
      const { container, getByRole } = renderRenameableBuffers();
      await tick();

      await fireEvent.contextMenu(getTab(container, 'BufferA'));
      await tick();

      expect(getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
      expect(getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    });

    it('does not show a context menu for Storage tab', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        storage: { particles: { count: 1024, elementType: 'float4' } },
        passes: { Image: { inputs: {} } },
      } as any;

      const { container, queryByRole } = render(ConfigPanel, {
        config,
        language: 'slang',
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/image.slang',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });
      await tick();

      // Need to get tab by finding the element
      const storageTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button'))
        .find(el => el.querySelector('.tab-label')?.textContent === 'Storage');
      if (storageTab) {
        await fireEvent.contextMenu(storageTab);
        await tick();
      }

      expect(queryByRole('menu')).toBeNull();
    });

    it('"Open" menu item calls onOpenInNewTab with "active"', async () => {
      const onOpenInNewTab = vi.fn();
      const { container, getByRole } = render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: {
            Image: { inputs: {} },
            common: { path: '/test/common.glsl' },
            BufferA: { path: '/test/bufferA.glsl', inputs: {} },
          },
          script: './shader.uniforms.ts',
        },
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onOpenInNewTab,
      });
      await tick();

      const bufferTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button'))
        .find(el => el.querySelector('.tab-label')?.textContent === 'BufferA')!;
      await fireEvent.contextMenu(bufferTab);
      await tick();

      await fireEvent.click(getByRole('menuitem', { name: 'Open' }));
      expect(onOpenInNewTab).toHaveBeenCalledWith('BufferA', 'active');
    });

    it('"Open" on Image tab calls onOpenInNewTab with "Image" and "active"', async () => {
      const onOpenInNewTab = vi.fn();
      const { container, getByRole } = render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: { Image: { inputs: {} }, BufferA: { path: '/test/bufferA.glsl', inputs: {} } },
        },
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onOpenInNewTab,
      });
      await tick();

      const imageTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button'))
        .find(el => el.querySelector('.tab-label')?.textContent === 'Image')!;
      await fireEvent.contextMenu(imageTab);
      await tick();

      await fireEvent.click(getByRole('menuitem', { name: 'Open' }));
      expect(onOpenInNewTab).toHaveBeenCalledWith('Image', 'active');
    });

    it('"Open" on Common tab calls onOpenInNewTab with "common" and "active"', async () => {
      const onOpenInNewTab = vi.fn();
      const { container, getByRole } = render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: {
            Image: { inputs: {} },
            common: { path: '/test/common.glsl' },
          },
        },
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onOpenInNewTab,
      });
      await tick();

      const commonTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button'))
        .find(el => el.querySelector('.tab-label')?.textContent === 'Common')!;
      await fireEvent.contextMenu(commonTab);
      await tick();

      await fireEvent.click(getByRole('menuitem', { name: 'Open' }));
      expect(onOpenInNewTab).toHaveBeenCalledWith('common', 'active');
    });

    it('"Open" on Script tab calls onOpenInNewTab with "Script" and "active"', async () => {
      const onOpenInNewTab = vi.fn();
      const { container, getByRole } = render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: { Image: { inputs: {} } },
          script: './shader.uniforms.ts',
        } as any,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onOpenInNewTab,
      });
      await tick();

      const scriptTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button'))
        .find(el => el.querySelector('.tab-label')?.textContent === 'Script')!;
      await fireEvent.contextMenu(scriptTab);
      await tick();

      await fireEvent.click(getByRole('menuitem', { name: 'Open' }));
      expect(onOpenInNewTab).toHaveBeenCalledWith('Script', 'active');
    });

    it('context menu "Open" switches overlay and calls onOpenInNewTab when overlay is visible', async () => {
      const onOpenInNewTab = vi.fn();
      const { container, getByRole } = render(ConfigPanel, {
        config: {
          version: '1.0',
          passes: { Image: { inputs: {} }, BufferA: { path: '/test/bufferA.glsl', inputs: {} } },
        },
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        onOpenInNewTab,
      });
      setEditorOverlayVisible(true);
      await tick();

      const bufferTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tab-button'))
        .find(el => el.querySelector('.tab-label')?.textContent === 'BufferA')!;
      await fireEvent.contextMenu(bufferTab);
      await tick();

      await fireEvent.click(getByRole('menuitem', { name: 'Open' }));
      expect(getOverlayActiveFile()).toBe('BufferA');
      expect(onOpenInNewTab).toHaveBeenCalledWith('BufferA', 'active');
    });
  });

  describe('double-click sends navigateToBuffer', () => {
    it('switches the visible overlay to the double-clicked buffer when unlocked', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );
      setEditorOverlayVisible(true);

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap: { Image: '/path/shader.glsl', BufferA: '/path/bufferA.glsl' },
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: false,
      });

      await tick();

      const bufferATab = getAllByRole('button').find((tab) => tab.textContent?.includes('BufferA'));
      expect(bufferATab).toBeTruthy();
      await fireEvent.dblClick(bufferATab!);

      expect(getOverlayActiveFile()).toBe('BufferA');
      expect(mockTransport.postMessage).not.toHaveBeenCalled();
    });

    it('should call onOpenInNewTab with "active" on double-click when buffer has path', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const onOpenInNewTab = vi.fn();

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap: { Image: '/path/shader.glsl', BufferA: '/path/bufferA.glsl' },
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: false,
        onOpenInNewTab,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      expect(bufferATab).toBeTruthy();
      await fireEvent.dblClick(bufferATab!);

      expect(onOpenInNewTab).toHaveBeenCalledWith('BufferA', 'active');
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

    it('should call onOpenInNewTab on double-click even when unlocked', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const onOpenInNewTab = vi.fn();

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap: { Image: '/path/shader.glsl', BufferA: '/path/bufferA.glsl' },
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: false,
        onOpenInNewTab,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      await fireEvent.dblClick(bufferATab!);

      expect(onOpenInNewTab).toHaveBeenCalledWith('BufferA', 'active');
    });

    it('should call onOpenInNewTab on double-click even when buffer has no path', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
        },
      };

      (ConfigManager as unknown as Mock).mockImplementation(() =>
        createMockConfigManager(['BufferA']),
      );

      const onOpenInNewTab = vi.fn();

      const { getAllByRole } = render(ConfigPanel, {
        config,
        pathMap: {},
        bufferPathMap: { Image: '/path/shader.glsl' }, // No BufferA path
        transport: mockTransport,
        shaderPath: '/path/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        isLocked: true,
        onOpenInNewTab,
      });

      await tick();

      const tabs = getAllByRole('button');
      const bufferATab = tabs.find(t => t.textContent?.includes('BufferA'));
      await fireEvent.dblClick(bufferATab!);

      // Still calls callback — resolution is up to the parent
      expect(onOpenInNewTab).toHaveBeenCalledWith('BufferA', 'active');
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
      const { container, queryByText } = render(ConfigPanel, {
        config: null,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(queryByText('Image')).toBeTruthy();
      expect(container.querySelector('.buffer-details > .config-item:first-child #path-input')).toBeNull();
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

      const { container, queryByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/shader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      expect(queryByText('Image')).toBeTruthy();
      expect(container.querySelector('.buffer-details > .config-item:first-child #path-input')).toBeNull();
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

  describe('script tab', () => {
    it('shows Script tab when config has script field', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: { Image: { inputs: {} } },
        script: './myshader.uniforms.ts',
      } as any;

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/myshader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();
      expect(getByText('Script')).toBeTruthy();
    });

    it('sends createScriptFile message when Script Create is clicked', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: { Image: { inputs: {} } },
        script: '',
      } as any;

      const mockManager = createMockConfigManager([]);
      mockManager.getConfig.mockReturnValue(config);
      mockManager.generateScriptPath.mockReturnValue('./myshader.uniforms.ts');
      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/myshader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        scriptInfo: null,
      });

      await tick();

      await fireEvent.click(getByText('Script'));
      await tick();

      const createBtn = getByText('Create');
      await fireEvent.click(createBtn);

      expect(mockTransport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'createFile' })
      );
    });

    it('sends selectScriptFile message with shaderPath when Select is clicked', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: { Image: { inputs: {} } },
        script: './myshader.uniforms.ts',
      } as any;

      const mockManager = createMockConfigManager([]);
      mockManager.generateScriptPath.mockReturnValue('./myshader.uniforms.ts');
      (ConfigManager as unknown as Mock).mockImplementation(() => mockManager);

      const { getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/myshader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
        scriptInfo: { filename: './myshader.uniforms.ts', uniforms: [], fileExists: true } as any,
      });

      await tick();

      await fireEvent.click(getByText('Script'));
      await tick();

      await fireEvent.click(getByText('Select'));

      expect(mockTransport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'selectFile' })
      );
    });

    it('does not show Script tab in New dropdown when script already exists', async () => {
      const config: ShaderConfig = {
        version: '1.0',
        passes: { Image: { inputs: {} } },
        script: './myshader.uniforms.ts',
      } as any;

      const { container, getByText } = render(ConfigPanel, {
        config,
        pathMap: {},
        transport: mockTransport,
        shaderPath: '/test/myshader.glsl',
        isVisible: true,
        onFileSelect: mockOnFileSelect,
        selectedBuffer: 'Image',
      });

      await tick();

      const addNewBtn = getByText('+ New');
      await fireEvent.mouseEnter(addNewBtn.closest('.add-tab-dropdown')!);
      await tick();

      // Script option should not appear in dropdown
      const dropdown = container.querySelector('.dropdown-content');
      expect(dropdown?.textContent).not.toContain('Script');
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
