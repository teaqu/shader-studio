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

    triggerDebugRecompile(): void {
      // Mock implementation
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

  it('should toggle config panel when config panel button is clicked', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization and MenuBar to render
    await tick();
    await tick();

    // Config panel should not be visible initially
    expect(container.querySelector('.config-section')).toBeFalsy();

    // Click the config panel toggle button
    const configButton = screen.getByLabelText('Toggle config panel');
    await fireEvent.click(configButton);
    await tick();

    // Config panel should now be visible
    expect(container.querySelector('.config-section')).toBeTruthy();
  });

  it('should display config panel button after initialization', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization and MenuBar to render
    await tick();
    await tick();

    // Config panel button should be present
    const configButton = screen.getByLabelText('Toggle config panel');
    expect(configButton).toBeTruthy();
  });

  it('should not display config panel button before initialization', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // The config panel button should not be present before initialization
    const configButton = container.querySelector('[aria-label="Toggle config panel"]');
    expect(configButton).toBeFalsy();
  });

  it('should toggle debug mode and send debugModeState message when enabled', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Clear any initialization messages
    vi.clearAllMocks();

    // Find and click the debug toggle button
    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);

    // Should post a debugModeState message with enabled: true
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'debugModeState',
      payload: {
        enabled: true
      }
    });
  });

  it('should toggle debug mode off and send debugModeState message when disabled', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Clear any initialization messages
    vi.clearAllMocks();

    // Click debug button twice to enable then disable
    const debugButton = screen.getByLabelText('Toggle debug mode');

    // First click - enable
    await fireEvent.click(debugButton);
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'debugModeState',
      payload: {
        enabled: true
      }
    });

    // Clear mocks
    vi.clearAllMocks();

    // Second click - disable
    await fireEvent.click(debugButton);
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'debugModeState',
      payload: {
        enabled: false
      }
    });
  });

  it('should not send debugModeState message before initialization', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Before initialization, the debug button should not be present
    const debugButton = container.querySelector('[aria-label="Toggle debug mode"]');
    expect(debugButton).toBeFalsy();

    // No messages should be sent
    expect(mockTransport.postMessage).not.toHaveBeenCalled();
  });

  it('should handle multiple debug toggle clicks correctly', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Clear any initialization messages
    vi.clearAllMocks();

    const debugButton = screen.getByLabelText('Toggle debug mode');

    // Multiple toggles
    for (let i = 0; i < 5; i++) {
      await fireEvent.click(debugButton);

      const expectedEnabled = (i + 1) % 2 === 1; // Odd clicks = enabled, even clicks = disabled

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'debugModeState',
        payload: {
          enabled: expectedEnabled
        }
      });

      vi.clearAllMocks();
    }
  });
});
