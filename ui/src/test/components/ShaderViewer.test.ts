import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ShaderViewer from '../../lib/components/ShaderViewer.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock dependencies
vi.mock('../../lib/ShaderStudio', () => {
  const MockShaderStudio = class {
    transport: Transport;
    
    constructor(transport: Transport) {
      this.transport = transport;
    }
    
    async initialize(glCanvas: HTMLCanvasElement): Promise<boolean> {
      return true;
    }
    
    async handleShaderMessage(event: any): Promise<{ running: boolean }> {
      return { running: true };
    }
    
    handleReset(onComplete?: () => void): void {
      onComplete?.();
    }
    
    handleRefresh(): void {
      // Mock implementation
    }
    
    handleTogglePause(): void {
      // Mock implementation
    }
    
    handleToggleLock(): void {
      // Mock implementation
    }
    
    getIsLocked(): boolean {
      return false;
    }
    
    getLastShaderEvent(): any {
      return {
        data: {
          path: '/mock/path/test.glsl'
        }
      };
    }
    
    getTimeManager(): any {
      return {
        getCurrentTime: () => 0.0,
        isPaused: () => false,
        getSpeed: () => 1.0,
        setSpeed: vi.fn(),
        isLoopEnabled: () => false,
        setLoopEnabled: vi.fn(),
        getLoopDuration: () => Math.PI * 2,
        setLoopDuration: vi.fn(),
        setTime: vi.fn()
      };
    }
    
    getCurrentFPS(): number {
      return 60.0;
    }

    getRenderingEngine(): any {
      return {
        readPixel: vi.fn().mockReturnValue({ r: 255, g: 128, b: 64, a: 255 }),
        render: vi.fn(),
      };
    }

    dispose(): void {
      // Mock implementation
    }
  };
  
  return {
    ShaderStudio: MockShaderStudio
  };
});

vi.mock('../../lib/transport/TransportFactory', () => ({
  createTransport: () => mockTransport,
  isVSCodeEnvironment: () => false
}));

// Mock transport
const mockTransport = {
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: () => 'vscode' as const,
  isConnected: () => true
} as Transport;

describe('ShaderViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    expect(container).toBeTruthy();
  });

  it('should call onInitialized callback after initialization', async () => {
    const onInitialized = vi.fn();
    
    render(ShaderViewer, {
      onInitialized
    });

    // Wait for initialization
    await tick();

    expect(onInitialized).toHaveBeenCalledWith({
      shaderStudio: expect.any(Object)
    });
  });

  it('should render MenuBar when initialized', async () => {
    const onInitialized = vi.fn();
    
    const { container } = render(ShaderViewer, {
      onInitialized
    });

    // Wait for initialization
    await tick();

    // Check that the component renders without errors
    expect(container).toBeTruthy();
    expect(container.querySelector('.main-container')).toBeTruthy();
  });

  it('should initialize correctly', async () => {
    const onInitialized = vi.fn();
    
    render(ShaderViewer, {
      onInitialized
    });

    // Wait for initialization
    await tick();

    // Verify the callback was called
    expect(onInitialized).toHaveBeenCalledWith({
      shaderStudio: expect.any(Object)
    });
  });

  it('should not send messages before initialization', async () => {
    const onInitialized = vi.fn();
    
    render(ShaderViewer, {
      onInitialized
    });

    // Verify no messages were sent before initialization
    expect(mockTransport.postMessage).not.toHaveBeenCalled();
  });

  it('should handle initialization without errors', async () => {
    const onInitialized = vi.fn();
    
    const { container } = render(ShaderViewer, {
      onInitialized
    });

    // Wait for initialization
    await tick();

    // Component should render without errors
    expect(container).toBeTruthy();
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('should handle config request correctly', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization and MenuBar to render
    await tick();
    await tick();

    // Open MenuBar options menu
    const optionsButton = screen.getByLabelText('Open options menu');
    await fireEvent.click(optionsButton);

    // Click Config
    const configButton = screen.getByLabelText('Open shader config');
    await fireEvent.click(configButton);

    // Should post a showConfig message with the .sha.json path
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'showConfig',
      payload: {
        shaderPath: '/mock/path/test.sha.json'
      }
    });
  });

  it('should handle config request when no shader path is available', async () => {
    // Mock getLastShaderEvent to return null
    const { ShaderStudio } = await import('../../lib/ShaderStudio');
    const originalGetLastShaderEvent = ShaderStudio.prototype.getLastShaderEvent;
    ShaderStudio.prototype.getLastShaderEvent = vi.fn().mockReturnValue(null);

    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization and MenuBar to render
    await tick();
    await tick();

    // Open MenuBar options menu
    const optionsButton = screen.getByLabelText('Open options menu');
    await fireEvent.click(optionsButton);

    // Click Config
    const configButton = screen.getByLabelText('Open shader config');
    await fireEvent.click(configButton);

    // Should fall back to generateConfig when there is no shader path
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'generateConfig',
      payload: {}
    });

    // Restore original method
    ShaderStudio.prototype.getLastShaderEvent = originalGetLastShaderEvent;
  });

  it('should not handle config request when not initialized', async () => {
    const onInitialized = vi.fn();
    
    const { container } = render(ShaderViewer, {
      onInitialized
    });

    // The config button should not be present before initialization
    const configButton = container.querySelector('[aria-label="Open shader config"]');
    expect(configButton).toBeFalsy();
  });
});
