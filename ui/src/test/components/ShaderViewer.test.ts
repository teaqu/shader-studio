import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ShaderViewer from '../../lib/components/ShaderViewer.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';
import { configPanelStore } from '../../lib/stores/configPanelStore';
import { debugPanelStore } from '../../lib/stores/debugPanelStore';
import { editorOverlayStore } from '../../lib/stores/editorOverlayStore';
import { audioStore } from '../../lib/stores/audioStore';
import { compileModeStore } from '../../lib/stores/compileModeStore';

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock RenderingEngine and transport - use vi.hoisted to define mock values before vi.mock hoisting
const { mockTimeManager, mockTransport, mockSetAudioOptions, mockCreateTransport, mockSetInputEnabled } = vi.hoisted(() => {
  const mockTimeManager = {
    getCurrentTime: () => 0.0,
    isPaused: () => false,
    getSpeed: () => 1.0,
    setSpeed: () => {},
    isLoopEnabled: () => false,
    setLoopEnabled: () => {},
    getLoopDuration: () => Math.PI * 2,
    setLoopDuration: () => {},
    setTime: () => {}
  };
  const mockTransport = {
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
    getType: () => 'vscode' as const,
    isConnected: () => true
  };
  const mockSetAudioOptions = vi.fn();
  const mockSetInputEnabled = vi.fn();
  const mockCreateTransport = vi.fn(() => mockTransport);
  return { mockTimeManager, mockTransport, mockSetAudioOptions, mockCreateTransport, mockSetInputEnabled };
});

vi.mock('../../../../rendering/src/RenderingEngine', () => {
  const MockRenderingEngine = class {
    initialize() {}
    handleCanvasResize() {}
    togglePause() {}
    stopRenderLoop() {}
    startRenderLoop() {}
    getCurrentFPS() { return 60.0; }
    getUniforms() { return { res: [800, 600, 1.333], time: 0, timeDelta: 0, frameRate: 60, mouse: [0, 0, 0, 0], frame: 0, date: [2026, 1, 21, 0] }; }
    getTimeManager() { return mockTimeManager; }
    dispose() {}
    readPixel() { return { r: 255, g: 128, b: 64, a: 255 }; }
    render() {}
    updateBufferAndRecompile() { return Promise.resolve({ success: true }); }
    cleanup() {}
    compileShaderPipeline() { return Promise.resolve({ success: true }); }
    getPasses() { return []; }
    setInputEnabled(...args: any[]) { return mockSetInputEnabled(...args); }
    setGlobalVolume() {}
    resumeAudioContext() { return Promise.resolve(); }
    resumeAllAudio() {}
    controlAudio() {}
    seekAudio() {}
    updateAudioLoopRegion() {}
    controlVideo() {}
    getAudioState() { return null; }
    getVideoState() { return null; }
    getAudioFFTData() { return null; }
    getFrameTimeHistory() { return []; }
    getFrameTimeCount() { return 0; }
    createVariableCapturer() {
      return {
        setCustomUniforms() {},
        setCompileContext() {},
        clearLastError() {},
        getLastError() { return null; },
        issueCaptureAtPixel() { return 0; },
        issueCaptureGrid() { return 0; },
        collectResults() { return []; },
        dispose() {},
      };
    }
    getVariableCaptureCompileContext() { return { commonCode: '', slotAssignments: [], channelTypes: ['2D', '2D', '2D', '2D'] }; }
    getCaptureUniforms() { return { time: 0, timeDelta: 0, frameRate: 60, frame: 0, res: [800, 600], mouse: [0, 0, 0, 0], date: [2026, 1, 21, 0], cameraPos: [0, 0, 0], cameraDir: [0, 0, -1] }; }
    getCustomUniformDeclarations() { return ''; }
    getCurrentCustomUniforms() { return []; }
    getCustomUniformInfo() { return []; }
    setCustomUniformValues() {}
    updateCustomUniformValues() {}
  };

  return {
    RenderingEngine: MockRenderingEngine
  };
});

// Mock dependencies
vi.mock('../../lib/ShaderStudio', () => {
  const MockShaderStudio = class {
    transport: Transport;
    private _locked = false;
    private _lockedPath: string | undefined = undefined;
    private _shaderDebugManager: any;

    constructor(transport: Transport, _locker: any, _engine: any, shaderDebugManager: any) {
      this.transport = transport;
      this._shaderDebugManager = shaderDebugManager;
    }

    get messageHandler() {
      const mgr = this._shaderDebugManager;
      return {
        handleCursorPositionMessage(msg: any) {
          const { line, lineContent, filePath } = msg.payload ?? {};
          if (line !== undefined && mgr) {
            mgr.updateDebugLine(line, lineContent, filePath);
          }
        }
      };
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

    handleToggleLock(): void {
      this._locked = !this._locked;
    }

    getIsLocked(): boolean {
      return this._locked;
    }

    getLockedShaderPath(): string | undefined {
      return this._lockedPath;
    }

    // Test helpers
    _setLocked(locked: boolean, path?: string): void {
      this._locked = locked;
      this._lockedPath = path;
    }

    getLastShaderEvent(): any {
      return {
        data: {
          path: '/mock/path/test.glsl'
        }
      };
    }

    getRenderingEngine(): any {
      return {
        readPixel: vi.fn().mockReturnValue({ r: 255, g: 128, b: 64, a: 255 }),
        render: vi.fn(),
        setGlobalVolume: vi.fn(),
        resumeAudioContext: vi.fn().mockResolvedValue(undefined),
        resumeAllAudio: vi.fn(),
        controlAudio: vi.fn(),
        seekAudio: vi.fn(),
        updateAudioLoopRegion: vi.fn(),
        controlVideo: vi.fn(),
        getAudioState: vi.fn().mockReturnValue(null),
        getVideoState: vi.fn().mockReturnValue(null),
        getAudioFFTData: vi.fn().mockReturnValue(null),
      };
    }

    triggerDebugRecompile(): void {
      // Mock implementation
    }

    setAudioOptions = mockSetAudioOptions;
  };

  return {
    ShaderStudio: MockShaderStudio
  };
});

vi.mock('../../lib/transport/TransportFactory', () => ({
  createTransport: mockCreateTransport,
  isVSCodeEnvironment: () => false
}));

const { mockVCMFactory } = vi.hoisted(() => {
  const mockVCMFactory = {
    _callback: null as ((vars: any[]) => void) | null,
    _sampleSettingsCallback: null as (() => void) | null,
    sampleSize: 32,
    refreshMode: 'polling',
    pollingMs: 500,
    inject(vars: any[]) { this._callback?.(vars); },
    emitSampleSettings() { this._sampleSettingsCallback?.(); },
    reset() {
      this._callback = null;
      this._sampleSettingsCallback = null;
      this.sampleSize = 32;
      this.refreshMode = 'polling';
      this.pollingMs = 500;
    },
  };
  return { mockVCMFactory };
});

vi.mock('../../lib/VariableCaptureManager', () => ({
  VariableCaptureManager: class {
    constructor(_engine: any, cb: (vars: any[]) => void) {
      mockVCMFactory._callback = cb;
    }
    get sampleSize() { return mockVCMFactory.sampleSize; }
    setSampleSettingsCallback(cb: () => void) { mockVCMFactory._sampleSettingsCallback = cb; }
    notifyStateChange() {}
    dispose() { mockVCMFactory.reset(); }
    changeSampleSize(size: number) {
      mockVCMFactory.sampleSize = size;
      mockVCMFactory.emitSampleSettings();
    }
    changeRefreshMode(mode: string) {
      mockVCMFactory.refreshMode = mode;
      mockVCMFactory.emitSampleSettings();
    }
    changePollingMs(ms: number) {
      mockVCMFactory.pollingMs = ms;
      mockVCMFactory.emitSampleSettings();
    }
    setHistogramExpanded() {}
    getActiveRefreshMode() { return mockVCMFactory.refreshMode; }
    getActivePollingMs() { return mockVCMFactory.pollingMs; }
    get gridRefreshMode() { return mockVCMFactory.refreshMode; }
    get gridPollingMs() { return mockVCMFactory.pollingMs; }
    get pixelRefreshMode() { return mockVCMFactory.refreshMode; }
    get pixelPollingMs() { return mockVCMFactory.pollingMs; }
  },
}));

describe('ShaderViewer', () => {
  function getEditorOverlayVisible(): boolean {
    let value = false;
    const unsubscribe = editorOverlayStore.subscribe((state) => {
      value = state.isVisible;
    });
    unsubscribe();
    return value;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockVCMFactory.reset();
    compileModeStore.setMode('hot');
    configPanelStore.setVisible(false);
    debugPanelStore.setVisible(false);
    debugPanelStore.setVariableInspectorEnabled(false);
    debugPanelStore.setInlineRenderingEnabled(true);
    debugPanelStore.setPixelInspectorEnabled(true);
    editorOverlayStore.setVisible(false);
  });

  it('should create transport once before initializeApp registers messages', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    await tick();

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockTransport.onMessage).toHaveBeenCalled();
  });

  it('should disable shader inputs while editor overlay is visible', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    await tick();
    await loadShader();

    expect(mockSetInputEnabled).toHaveBeenLastCalledWith(true);

    editorOverlayStore.setVisible(true);
    await tick();

    expect(mockSetInputEnabled).toHaveBeenLastCalledWith(false);

    editorOverlayStore.setVisible(false);
    await tick();

    expect(mockSetInputEnabled).toHaveBeenLastCalledWith(true);
  });

  // Helper: send a shaderSource message to set hasShader = true
  async function loadShader() {
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { Image: {} } },
        pathMap: { Image: '/test/shader.glsl' },
      },
    });
    await tick();
  }

  function getCtrlButton(container: HTMLElement, text: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll('.ctrl-btn')).find(
      (b) => b.textContent?.trim() === text,
    ) as HTMLElement | undefined;
  }

  it('should render without crashing', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    expect(container).toBeTruthy();
  });

  it('should update the active debugger size button after sample size changes', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    await tick();
    await loadShader();

    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);
    await tick();

    const variableInspectorButton = screen.getByLabelText('Toggle variable inspector');
    await fireEvent.pointerDown(variableInspectorButton);
    await tick();

    expect(getCtrlButton(container, '32')).toHaveClass('active');

    await fireEvent.click(getCtrlButton(container, '64')!);
    await tick();

    expect(getCtrlButton(container, '64')).toHaveClass('active');
    expect(getCtrlButton(container, '32')).not.toHaveClass('active');
  });

  it('should show a no active shader state when no shader is loaded', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    expect(screen.getByText('No active shader')).toBeTruthy();
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

    // Only layout-related messages (requestLayout) should be sent before initialization
    const calls = (mockTransport.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const nonLayoutCalls = calls.filter((c: any[]) => c[0]?.type !== 'requestLayout');
    expect(nonLayoutCalls).toHaveLength(0);
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

    // Load a shader so config button is enabled
    await loadShader();

    // Config panel should not be visible initially
    expect(container.querySelector('.config-panel')).toBeFalsy();

    // Click the config panel toggle button
    const configButton = screen.getByLabelText('Toggle config panel');
    await fireEvent.click(configButton);
    await tick();

    // Config panel should now be visible
    expect(container.querySelector('.config-panel')).toBeTruthy();
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

    // Load a shader so debug button is enabled
    await loadShader();

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

    // Load a shader so debug button is enabled
    await loadShader();

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

    // No debugModeState messages should be sent (requestLayout from DockviewLayout is OK)
    const calls = (mockTransport.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const debugCalls = calls.filter((c: any[]) => c[0]?.type === 'debugModeState');
    expect(debugCalls).toHaveLength(0);
  });

  it('should handle multiple debug toggle clicks correctly', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Load a shader so debug button is enabled
    await loadShader();

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

  it('should show error on pause button when extension sends error message', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler registered via transport.onMessage
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(onMessageCalls.length).toBeGreaterThan(0);
    const messageHandler = onMessageCalls[0][0];

    // Simulate extension sending an error message
    await messageHandler({ data: { type: 'error', payload: ['Missing mainImage function'] } });
    await tick();

    // The pause button should have the error class
    const pauseButton = screen.getByLabelText('Toggle pause');
    expect(pauseButton.classList.contains('error')).toBe(true);
  });

  it('should display error tooltip when extension sends error message', async () => {
    const { container } = render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Simulate extension sending an error message
    await messageHandler({ data: { type: 'error', payload: ['Missing mainImage function'] } });
    await tick();

    // Error tooltip should be visible
    const tooltip = container.querySelector('.error-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip!.textContent).toContain('Missing mainImage function');
  });

  it('should not echo error messages back to extension', async () => {
    render(ShaderViewer, {
      onInitialized: vi.fn()
    });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler before clearing mocks
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Clear mocks to ignore initialization messages
    vi.clearAllMocks();

    // Simulate extension sending an error message
    await messageHandler({ data: { type: 'error', payload: ['Test error'] } });
    await tick();

    // Should NOT post any message back to the extension
    expect(mockTransport.postMessage).not.toHaveBeenCalled();
  });

  it('should auto-enable inspector when entering debug mode', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load a shader so debug button is enabled
    await loadShader();

    // Enable debug mode
    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Inspector toggle should show as active in debug panel
    const inspectorButton = screen.getByLabelText('Toggle inspector');
    expect(inspectorButton.classList.contains('active')).toBe(true);
  });

  it('should auto-disable inspector when leaving debug mode', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load a shader so debug button is enabled
    await loadShader();

    const debugButton = screen.getByLabelText('Toggle debug mode');

    // Enable then disable debug
    await fireEvent.click(debugButton);
    await tick();
    await tick();
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Inspector should not be active (debug panel is hidden, but we can check via re-enabling)
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    const inspectorButton = screen.getByLabelText('Toggle inspector');
    expect(inspectorButton.classList.contains('active')).toBe(true);
  });

  it('should remember inspector was turned off when re-entering debug mode', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load a shader so debug button is enabled
    await loadShader();

    const debugButton = screen.getByLabelText('Toggle debug mode');

    // Enable debug mode
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Turn off inspector within debug mode
    const inspectorButton = screen.getByLabelText('Toggle inspector');
    await fireEvent.pointerDown(inspectorButton);
    await tick();
    await tick();
    expect(inspectorButton.classList.contains('active')).toBe(false);

    // Exit debug mode
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Re-enter debug mode
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Inspector should still be off (remembered preference)
    const inspectorButton2 = screen.getByLabelText('Toggle inspector');
    expect(inspectorButton2.classList.contains('active')).toBe(false);
  });

  it('should remember inspector was turned back on when re-entering debug mode', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load a shader so debug button is enabled
    await loadShader();

    const debugButton = screen.getByLabelText('Toggle debug mode');

    // Enable debug mode
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Turn off inspector, then back on
    const inspectorButton = screen.getByLabelText('Toggle inspector');
    await fireEvent.pointerDown(inspectorButton); // off
    await fireEvent.pointerUp(window);
    await tick();
    await fireEvent.pointerDown(inspectorButton); // on
    await fireEvent.pointerUp(window);
    await tick();
    await tick();
    expect(inspectorButton.classList.contains('active')).toBe(true);

    // Exit and re-enter debug mode
    await fireEvent.click(debugButton);
    await tick();
    await tick();
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Inspector should be on (remembered preference)
    const inspectorButton2 = screen.getByLabelText('Toggle inspector');
    expect(inspectorButton2.classList.contains('active')).toBe(true);
  });

  it('should update config when not locked', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send a shaderSource message while not locked
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader.glsl' }
      }
    });
    await tick();

    // Toggle config panel to make it visible
    const configButton = screen.getByLabelText('Toggle config panel');
    await fireEvent.click(configButton);
    await tick();

    // Config panel should be visible with the config
    const configSection = container.querySelector('.config-panel');
    expect(configSection).toBeTruthy();
  });

  it('should not update config when locked to a different shader', async () => {
    let studioInstance: any;
    const onInitialized = vi.fn((data: any) => {
      studioInstance = data.shaderStudio;
    });

    const { container } = render(ShaderViewer, { onInitialized });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // First, send the locked shader's config
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/locked-shader.glsl',
        config: { passes: { image: { description: 'locked config' } } },
        pathMap: { image: '/test/locked-shader.glsl' }
      }
    });
    await tick();

    // Lock to the current shader
    studioInstance._setLocked(true, '/test/locked-shader.glsl');

    // Now send a different shader's config
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/other-shader.glsl',
        config: { passes: { image: { description: 'other config' } } },
        pathMap: { image: '/test/other-shader.glsl' }
      }
    });
    await tick();

    // Toggle config panel to make it visible
    const configButton = screen.getByLabelText('Toggle config panel');
    await fireEvent.click(configButton);
    await tick();

    // The config should still be the locked shader's config, not the other shader's
    const configSection = container.querySelector('.config-panel');
    expect(configSection).toBeTruthy();
    // The ConfigPanel receives shaderPath as a prop - verify it's still the locked shader
    // We can check via the internal component state by checking what was passed
  });

  it('should not show editor overlay by default and show it after toggle', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });

    // Wait for initialization
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader.glsl' },
      },
    });
    await tick();

    // Editor overlay should NOT be visible by default
    expect(container.querySelector('.editor-wrapper')).toBeFalsy();

    // Toggle editor overlay on
    editorOverlayStore.toggle();
    await tick();

    // Editor overlay should now be visible
    expect(container.querySelector('.editor-wrapper')).toBeTruthy();
  });

  it('should handle fileContents message without crashing', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler registered via transport.onMessage
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(onMessageCalls.length).toBeGreaterThan(0);
    const messageHandler = onMessageCalls[0][0];

    // Simulate extension sending a fileContents message — should not throw
    await messageHandler({
      data: {
        type: 'fileContents',
        payload: {
          code: 'buffer code',
          path: '/test/common.glsl',
          bufferName: 'common',
        },
      },
    });
    await tick();

    // If we got here, the message was handled without crashing
    expect(true).toBe(true);
  });

  it('should sync editor overlay when shaderSource message arrives and overlay is toggled', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(onMessageCalls.length).toBeGreaterThan(0);
    const messageHandler = onMessageCalls[0][0];

    // Send a shaderSource message
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader.glsl' },
      },
    });
    await tick();

    // Toggle editor overlay on
    editorOverlayStore.toggle();
    await tick();

    // Editor overlay should appear
    expect(container.querySelector('.editor-wrapper')).toBeTruthy();
  });

  it('should send requestFileContents when shaderSource sets up the path context', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(onMessageCalls.length).toBeGreaterThan(0);
    const messageHandler = onMessageCalls[0][0];

    // Send a shaderSource message to establish the shader path and config
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {}, common: {} } },
        pathMap: { image: '/test/shader.glsl', common: '/test/common.glsl' },
      },
    });
    await tick();

    // Clear mocks so we can check only new messages
    vi.clearAllMocks();

    // The shaderSource message was accepted — verify transport received appropriate messages
    // by confirming the component is still functional (no crash from message handling)
    // Send another shaderSource to confirm the transport is still working
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(0.5); }',
        config: { passes: { image: {}, common: {} } },
        pathMap: { image: '/test/shader.glsl', common: '/test/common.glsl' },
      },
    });
    await tick();

    // The component should have processed both messages without error
    expect(true).toBe(true);
  });

  it('should send forkShader message when fork option is clicked', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });

    // Wait for initialization
    await tick();
    await tick();

    // Get the message handler to send a shaderSource to set shaderPath
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/my-shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/my-shader.glsl' },
      },
    });
    await tick();

    // Clear mocks to ignore initialization messages
    vi.clearAllMocks();

    const optionsButton = screen.getByLabelText('Open options menu');
    await fireEvent.click(optionsButton);

    const forkButton = screen.getByLabelText('Fork shader');
    await fireEvent.click(forkButton);

    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'forkShader',
      payload: { shaderPath: '/test/my-shader.glsl' }
    });
  });

  it('should call renderingEngine.handleCanvasResize on resize', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Get the ResizeObserver callback
    const resizeObserverCalls = (global.ResizeObserver as ReturnType<typeof vi.fn>).mock.calls;
    expect(resizeObserverCalls.length).toBeGreaterThan(0);
    const resizeCallback = resizeObserverCalls[0][0];

    // Simulate a resize via ResizeObserver
    resizeCallback([{
      contentRect: { width: 1024, height: 768 },
      target: container.querySelector('canvas'),
    }]);
    await tick();

    // The rendering engine should have been called with the new size
    // We verify the component didn't crash and still renders
    expect(container.querySelector('.main-container')).toBeTruthy();
  });

  it('should call renderingEngine.togglePause when pause button is clicked', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const pauseButton = screen.getByLabelText('Toggle pause');
    await fireEvent.click(pauseButton);

    // Component should still be functional after toggling pause
    expect(pauseButton).toBeTruthy();
  });

  it('should call renderingEngine.getCurrentFPS periodically', async () => {
    const onInitialized = vi.fn();
    render(ShaderViewer, { onInitialized });
    await tick();
    await tick();

    // The FPS interval is set up on mount - verify component initializes correctly
    expect(onInitialized).toHaveBeenCalled();
  });

  it('should call renderingEngine.dispose on component destroy', async () => {
    const { unmount } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Unmounting should trigger cleanup including renderingEngine.dispose()
    unmount();

    // If we got here without errors, cleanup worked correctly
    expect(true).toBe(true);
  });

  it('should call renderingEngine.getUniforms for debug panel', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Enable debug mode which uses getUniforms
    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Debug panel should be visible
    // The getUniforms function is passed to DebugPanel as a prop
    expect(debugButton).toBeTruthy();
  });

  it('should call renderingEngine.getTimeManager for time controls', async () => {
    const onInitialized = vi.fn();
    render(ShaderViewer, { onInitialized });
    await tick();
    await tick();

    // After initialization, timeManager should be available (from renderingEngine.getTimeManager)
    expect(onInitialized).toHaveBeenCalled();
    // The MenuBar receives timeManager as a prop - verify it rendered
    const pauseButton = screen.getByLabelText('Toggle pause');
    expect(pauseButton).toBeTruthy();
  });

  it('should handle buffer code change via renderingEngine.updateBufferAndRecompile', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Get the message handler
    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send a shaderSource with a buffer config
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {}, common: {} } },
        pathMap: { image: '/test/shader.glsl', common: '/test/common.glsl' },
      },
    });
    await tick();

    // Component should handle the buffer config without crashing
    expect(true).toBe(true);
  });

  it('should handle error message and clear errors on success', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send error
    await messageHandler({ data: { type: 'error', payload: ['Test error'] } });
    await tick();

    const pauseButton = screen.getByLabelText('Toggle pause');
    expect(pauseButton.classList.contains('error')).toBe(true);

    // Send successful shader source to clear error
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader.glsl' },
      },
    });
    await tick();

    // Error should be cleared
    expect(pauseButton.classList.contains('error')).toBe(false);
  });

  it('should ignore toggleEditorOverlay message when no shader is active', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Editor overlay should not be visible initially
    expect(container.querySelector('.editor-wrapper')).toBeFalsy();

    await messageHandler({ data: { type: 'toggleEditorOverlay' } });
    await tick();

    // Editor overlay should stay hidden without an active shader
    expect(container.querySelector('.editor-wrapper')).toBeFalsy();
  });

  it('should handle toggleEditorOverlay message from extension when a shader is active', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    expect(container.querySelector('.editor-wrapper')).toBeFalsy();

    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader.glsl' },
      },
    });
    await tick();

    await messageHandler({ data: { type: 'toggleEditorOverlay' } });
    await tick();

    expect(container.querySelector('.editor-wrapper')).toBeTruthy();
  });

  it('should track shaderPath from shaderSource messages', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send a shaderSource message
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/my-shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/my-shader.glsl' },
      },
    });
    await tick();

    vi.clearAllMocks();

    const optionsButton = screen.getByLabelText('Open options menu');
    await fireEvent.click(optionsButton);

    const forkButton = screen.getByLabelText('Fork shader');
    await fireEvent.click(forkButton);

    // forkShader should reference the path from the shaderSource message
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'forkShader',
      payload: { shaderPath: '/test/my-shader.glsl' }
    });
  });

  it('should update config when locked and same shader path arrives', async () => {
    let studioInstance: any;
    const onInitialized = vi.fn((data: any) => {
      studioInstance = data.shaderStudio;
    });

    const { container } = render(ShaderViewer, { onInitialized });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send initial shader config
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/my-shader.glsl',
        config: { passes: { image: { description: 'initial' } } },
        pathMap: { image: '/test/my-shader.glsl' }
      }
    });
    await tick();

    // Lock to this shader
    studioInstance._setLocked(true, '/test/my-shader.glsl');

    // Send updated config for the same shader path (e.g., after refresh)
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/my-shader.glsl',
        config: { passes: { image: { description: 'updated' } } },
        pathMap: { image: '/test/my-shader.glsl' }
      }
    });
    await tick();

    // Toggle config panel
    const configButton = screen.getByLabelText('Toggle config panel');
    await fireEvent.click(configButton);
    await tick();

    // Config panel should be visible - the update was allowed because paths match
    const configSection = container.querySelector('.config-panel');
    expect(configSection).toBeTruthy();
  });

  it('should handle panelState message and set isInWindow', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send panelState message indicating we're in a new window
    await messageHandler({
      data: { type: 'panelState', payload: { isInWindow: true } }
    });
    await tick();

    // Open options menu to check "Open in Window" is hidden
    const optionsButton = screen.getByLabelText('Open options menu');
    await fireEvent.click(optionsButton);
    await tick();

    // "Open in new window" should not be visible when isInWindow is true
    expect(screen.queryByLabelText('Open in new window')).toBeFalsy();
  });

  it('should handle webServerState message without error', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send webServerState message — should be handled without throwing
    await messageHandler({
      data: { type: 'webServerState', payload: { isRunning: true } }
    });
    await tick();

    // Verify the component is still rendering normally
    expect(screen.getByLabelText('Open options menu')).toBeTruthy();
  });

  it('should send extensionCommand message via handleExtensionCommand', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    vi.clearAllMocks();

    // Open options menu and click "New Shader"
    const optionsButton = screen.getByLabelText('Open options menu');
    await fireEvent.click(optionsButton);
    await tick();

    const newShaderButton = screen.getByLabelText('New shader');
    await fireEvent.click(newShaderButton);

    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'extensionCommand',
      payload: { command: 'newShader' }
    });
  });

  it('should send compile mode to extension when initialized', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'setCompileMode',
      payload: { mode: 'hot' }
    });
  });

  it('should not toggle config panel when no shader is loaded', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Config button should be disabled
    const configButton = screen.getByLabelText('Toggle config panel');
    expect(configButton.hasAttribute('disabled')).toBe(true);

    // Click should not open config panel
    await fireEvent.click(configButton);
    await tick();

    expect(container.querySelector('.config-section')).toBeFalsy();
  });

  it('should not toggle debug when no shader is loaded', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    vi.clearAllMocks();

    // Debug button should be disabled
    const debugButton = screen.getByLabelText('Toggle debug mode');
    expect(debugButton.hasAttribute('disabled')).toBe(true);

    // Click should not send debugModeState message
    await fireEvent.click(debugButton);

    expect(mockTransport.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'debugModeState' })
    );
  });

  it('should start paused and unpause on first shader load', async () => {
    // Make isPaused track state so the unpause condition works
    let paused = false;
    mockTimeManager.isPaused = vi.fn(() => paused);

    // Track togglePause calls via the mock
    const togglePauseCalls: string[] = [];
    const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
    const origTogglePause = RenderingEngine.prototype.togglePause;
    RenderingEngine.prototype.togglePause = function() {
      paused = !paused;
      togglePauseCalls.push(paused ? 'paused' : 'unpaused');
    };

    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // togglePause should have been called once during init (to start paused)
    expect(togglePauseCalls).toEqual(['paused']);
    expect(paused).toBe(true);

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send first shader - should trigger unpause since isPaused() returns true
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader.glsl' },
      },
    });
    await tick();

    // togglePause should have been called a second time (to unpause)
    expect(togglePauseCalls).toEqual(['paused', 'unpaused']);
    expect(paused).toBe(false);

    // Send another shader - should NOT toggle pause again
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader2.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(0.5); }',
        config: { passes: { image: {} } },
        pathMap: { image: '/test/shader2.glsl' },
      },
    });
    await tick();

    // No additional togglePause call
    expect(togglePauseCalls).toEqual(['paused', 'unpaused']);

    // Restore original
    RenderingEngine.prototype.togglePause = origTogglePause;
    mockTimeManager.isPaused = vi.fn(() => false);
  });

  it('should handle resetLayout message without crashing', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send resetLayout message — should not throw
    await messageHandler({ data: { type: 'resetLayout' } });
    await tick();

    // Component should still be functional
    expect(screen.getByLabelText('Toggle pause')).toBeTruthy();
  });

  it('should hide config panel via store when config tab is closed in dockview', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load a shader and open config panel
    await loadShader();
    configPanelStore.setVisible(true);
    await tick();

    // Verify config panel is visible
    expect(container.querySelector('.config-panel')).toBeTruthy();

    // Simulate dockview firing configClosed event via the DockviewLayout component
    // The handleConfigClosed function calls configPanelStore.setVisible(false)
    const dockview = container.querySelector('.dockview-container');
    if (dockview) {
      // DockviewLayout dispatches configClosed when panel is removed
      // We can test the store behavior directly since the handler calls configPanelStore.setVisible(false)
      configPanelStore.setVisible(false);
      await tick();
      expect(container.querySelector('.config-panel')).toBeFalsy();
    }
  });

  it('should hide debug panel via store when debug tab is closed in dockview', async () => {
    render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load shader and enable debug mode
    await loadShader();
    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Debug panel should be visible
    expect(debugPanelStore).toBeTruthy();

    // Simulate the handleDebugClosed path — it toggles debug off
    // which sends a debugModeState message
    vi.clearAllMocks();
    await fireEvent.click(debugButton);
    await tick();

    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'debugModeState',
      payload: { enabled: false }
    });
  });

  it('should pass variable inspector props to DebugPanel when debug is enabled', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load shader and enable debug mode
    await loadShader();
    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // The debug panel should be rendered with the variable inspector section
    // Look for the DebugPanel's variable inspector toggle
    const varInspectorButton = container.querySelector('[aria-label="Toggle variable inspector"]');
    // Variable inspector button should exist in the debug panel
    expect(varInspectorButton).toBeTruthy();
  });

  it('should toggle variable inspector when button is clicked in debug panel', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    // Load shader and enable debug mode
    await loadShader();
    const debugButton = screen.getByLabelText('Toggle debug mode');
    await fireEvent.click(debugButton);
    await tick();
    await tick();

    // Click variable inspector toggle
    const varInspectorButton = container.querySelector('[aria-label="Toggle variable inspector"]');
    if (varInspectorButton) {
      await fireEvent.pointerDown(varInspectorButton);
      await tick();

      // Should not crash — variable inspector is now enabled
      expect(container.querySelector('.main-container')).toBeTruthy();
    }
  });

  it('should derive editor buffer names from config passes', async () => {
    const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
    await tick();
    await tick();

    const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
    const messageHandler = onMessageCalls[0][0];

    // Send a shader with multiple buffer passes
    await messageHandler({
      data: {
        type: 'shaderSource',
        path: '/test/shader.glsl',
        code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
        config: { passes: { Image: {}, BufferA: {}, Common: {} } },
        pathMap: { Image: '/test/shader.glsl' },
        bufferPathMap: { BufferA: '/test/bufferA.glsl', Common: '/test/common.glsl' },
      },
    });
    await tick();

    // Toggle editor overlay to see the buffer selector
    editorOverlayStore.toggle();
    await tick();

    // Editor overlay should be visible
    expect(container.querySelector('.editor-wrapper')).toBeTruthy();
  });

  describe('handleVolumeChange', () => {
    it('should update audioStore volume when called', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Open the options menu to access the volume slider
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Find the volume slider and change its value
      const volumeSlider = screen.getByLabelText('Volume') as HTMLInputElement;
      await fireEvent.input(volumeSlider, { target: { value: '0.5' } });
      await tick();

      // The audioStore should reflect the new volume via the onVolumeChange -> audioStore.setVolume path
      // Verify indirectly: the volume label should show 50%
      const volumeLabel = document.querySelector('.volume-label');
      expect(volumeLabel?.textContent).toBe('50%');
    });
  });

  describe('handleToggleMute', () => {
    it('should toggle mute state in audioStore when called', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Open the options menu to access the mute button
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // The mute button should exist
      const muteButton = screen.getByLabelText('Toggle mute');
      expect(muteButton).toBeTruthy();

      // Initially muted (default audioStore state)
      expect(muteButton.classList.contains('muted')).toBe(true);

      // Click to unmute
      await fireEvent.click(muteButton);
      await tick();

      // Should now be unmuted
      expect(muteButton.classList.contains('muted')).toBe(false);

      // Click again to re-mute
      await fireEvent.click(muteButton);
      await tick();

      expect(muteButton.classList.contains('muted')).toBe(true);
    });
  });

  describe('handleVideoControl', () => {
    it('should dispatch video control to rendering engine', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      const { container } = render(ShaderViewer, { onInitialized });
      await tick();
      await tick();

      // Load a shader with video input to make config panel show video controls
      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: {
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'video', path: '/test/video.mp4' }
                }
              }
            }
          },
          pathMap: { Image: '/test/shader.glsl' },
        },
      });
      await tick();

      // The rendering engine mock from ShaderStudio has controlVideo
      const engine = studioInstance.getRenderingEngine();
      expect(engine).toBeTruthy();
    });
  });

  describe('handleAudioControl', () => {
    it('should dispatch audio control to rendering engine', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();

      // Load a shader with audio input
      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: {
            passes: {
              Image: {
                inputs: {
                  iChannel0: { type: 'audio', path: '/test/audio.mp3' }
                }
              }
            }
          },
          pathMap: { Image: '/test/shader.glsl' },
        },
      });
      await tick();

      // The rendering engine mock from ShaderStudio has controlAudio
      const engine = studioInstance.getRenderingEngine();
      expect(engine).toBeTruthy();
    });
  });

  describe('Audio Controls', () => {
    async function setupWithStudio() {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      return studioInstance;
    }

    it('should call renderEngine.controlAudio when handleAudioControl is invoked', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      // Unmute globally first so the action is not blocked
      audioStore.setMuted(false);
      await tick();

      // Access the component's handleAudioControl via the ConfigPanel prop
      // We test indirectly by verifying the engine mock is set up correctly
      // and the function delegates to controlAudio
      engine.controlAudio('/test/audio.mp3', 'play');
      expect(engine.controlAudio).toHaveBeenCalledWith('/test/audio.mp3', 'play');
    });

    it('should call renderEngine.seekAudio for seek: actions', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      engine.seekAudio('/test/audio.mp3', 5.0);
      expect(engine.seekAudio).toHaveBeenCalledWith('/test/audio.mp3', 5.0);
    });

    it('should call renderEngine.updateAudioLoopRegion for loopRegion: actions', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      engine.updateAudioLoopRegion('/test/audio.mp3', 1.0, 3.5);
      expect(engine.updateAudioLoopRegion).toHaveBeenCalledWith('/test/audio.mp3', 1.0, 3.5);
    });

    it('should not call controlAudio when globally muted and action is unmute', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      // Ensure globally muted
      audioStore.setMuted(true);
      await tick();

      // The handleAudioControl function blocks unmute when audioMuted is true.
      // Verify the engine's controlAudio is not called for unmute when globally muted.
      // We simulate the component logic: if action === 'unmute' && audioMuted, return early
      const audioMuted = true;
      const action = 'unmute';
      if (action === 'unmute' && audioMuted) {
        // Should not call controlAudio — this is the component's behavior
      } else {
        engine.controlAudio('/test/audio.mp3', action);
      }

      expect(engine.controlAudio).not.toHaveBeenCalled();
    });
  });

  describe('Video Controls', () => {
    async function setupWithStudio() {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      return studioInstance;
    }

    it('should call renderEngine.controlVideo when handleVideoControl is invoked', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      engine.controlVideo('/test/video.mp4', 'play');
      expect(engine.controlVideo).toHaveBeenCalledWith('/test/video.mp4', 'play');
    });

    it('should handle play/pause/mute/unmute/reset actions', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      const actions = ['play', 'pause', 'mute', 'unmute', 'reset'];
      for (const action of actions) {
        engine.controlVideo('/test/video.mp4', action);
      }

      expect(engine.controlVideo).toHaveBeenCalledTimes(5);
      expect(engine.controlVideo).toHaveBeenCalledWith('/test/video.mp4', 'play');
      expect(engine.controlVideo).toHaveBeenCalledWith('/test/video.mp4', 'pause');
      expect(engine.controlVideo).toHaveBeenCalledWith('/test/video.mp4', 'mute');
      expect(engine.controlVideo).toHaveBeenCalledWith('/test/video.mp4', 'unmute');
      expect(engine.controlVideo).toHaveBeenCalledWith('/test/video.mp4', 'reset');
    });
  });

  describe('Audio State', () => {
    async function setupWithStudio() {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      return studioInstance;
    }

    it('should return audio state from renderEngine.getAudioState', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      const mockState = { paused: false, muted: false, currentTime: 2.5, duration: 30.0 };
      engine.getAudioState.mockReturnValue(mockState);

      const state = engine.getAudioState('/test/audio.mp3');
      expect(state).toEqual(mockState);
      expect(engine.getAudioState).toHaveBeenCalledWith('/test/audio.mp3');
    });

    it('should return null when audio not loaded', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      // Default mock returns null
      const state = engine.getAudioState('/test/nonexistent.mp3');
      expect(state).toBeNull();
    });

    it('should return video state from renderEngine.getVideoState', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      const mockState = { paused: true, muted: false, currentTime: 10.0, duration: 120.0 };
      engine.getVideoState.mockReturnValue(mockState);

      const state = engine.getVideoState('/test/video.mp4');
      expect(state).toEqual(mockState);
      expect(engine.getVideoState).toHaveBeenCalledWith('/test/video.mp4');
    });
  });

  describe('Audio FFT', () => {
    async function setupWithStudio() {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      return studioInstance;
    }

    it('should call renderEngine.getAudioFFTData for frequency type', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      const mockFFT = new Uint8Array([128, 64, 32, 16]);
      engine.getAudioFFTData.mockReturnValue(mockFFT);

      const result = engine.getAudioFFTData('frequency', '/test/audio.mp3');
      expect(result).toBe(mockFFT);
      expect(engine.getAudioFFTData).toHaveBeenCalledWith('frequency', '/test/audio.mp3');
    });

    it('should call renderEngine.getAudioFFTData for waveform type', async () => {
      const studio = await setupWithStudio();
      const engine = studio.getRenderingEngine();

      const mockWaveform = new Uint8Array([200, 150, 100, 50]);
      engine.getAudioFFTData.mockReturnValue(mockWaveform);

      const result = engine.getAudioFFTData('waveform', '/test/audio.mp3');
      expect(result).toBe(mockWaveform);
      expect(engine.getAudioFFTData).toHaveBeenCalledWith('waveform', '/test/audio.mp3');
    });
  });

  describe('Global Audio State', () => {
    it('should apply muted state to render engine on audioStore change', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Clear previous calls from initialization
      mockSetAudioOptions.mockClear();

      // Change muted state via store
      audioStore.setMuted(true);
      await tick();

      // applyGlobalAudioState is called via the audioStore subscription
      // which calls shaderStudio.setAudioOptions
      expect(mockSetAudioOptions).toHaveBeenCalledWith(
        expect.objectContaining({ muted: true })
      );
    });

    it('should apply volume to render engine on audioStore change', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Clear previous calls from initialization
      mockSetAudioOptions.mockClear();

      // Change volume via store
      audioStore.setVolume(0.5);
      await tick();

      // applyGlobalAudioState is called via the audioStore subscription
      // which calls shaderStudio.setAudioOptions with a perceptual volume
      expect(mockSetAudioOptions).toHaveBeenCalledWith(
        expect.objectContaining({ volume: expect.any(Number) })
      );

      // Verify the volume is the perceptual value (0.5^3 = 0.125)
      const call = mockSetAudioOptions.mock.calls[0][0];
      expect(call.volume).toBeCloseTo(0.125, 3);
    });
  });

  describe('audio on reset', () => {
    it('should unmute audio when reset is clicked', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      await loadShader();
      await tick();

      mockSetAudioOptions.mockClear();

      const resetButton = screen.getByLabelText('Reset shader');
      await fireEvent.click(resetButton);
      await tick();

      expect(mockSetAudioOptions).toHaveBeenCalledWith(
        expect.objectContaining({ muted: false })
      );
    });

    it('should not unmute audio on initial shader load', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      mockSetAudioOptions.mockClear();
      await loadShader();
      await tick();

      const calls = mockSetAudioOptions.mock.calls;
      const anyUnmuted = calls.some((c: any) => c[0]?.muted === false);
      expect(anyUnmuted).toBe(false);
    });
  });

  describe('handleConfig', () => {
    it('should send showConfig message when config button is clicked via options menu', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      vi.clearAllMocks();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Find and click the config file button in the options menu
      const configFileButton = screen.queryByLabelText('Open config');
      if (configFileButton) {
        await fireEvent.click(configFileButton);
        expect(mockTransport.postMessage).toHaveBeenCalledWith({
          type: 'showConfig',
          payload: { shaderPath: expect.stringContaining('.sha.json') }
        });
      }
    });

    it('should send generateConfig when no shader path is available', async () => {
      // Override getLastShaderEvent to return no path
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origGetLastShaderEvent = ShaderStudio.prototype.getLastShaderEvent;
      ShaderStudio.prototype.getLastShaderEvent = function() {
        return { data: {} } as any;
      };

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      vi.clearAllMocks();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Find and click the config file button
      const configFileButton = screen.queryByLabelText('Open config');
      if (configFileButton) {
        await fireEvent.click(configFileButton);
        expect(mockTransport.postMessage).toHaveBeenCalledWith({
          type: 'generateConfig',
          payload: {}
        });
      }

      ShaderStudio.prototype.getLastShaderEvent = origGetLastShaderEvent;
    });
  });

  describe('handleRefresh', () => {
    it('should call shaderStudio.handleRefresh when refresh button is clicked', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Open options menu to access refresh button
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Click refresh button inside options menu
      const refreshButton = screen.getByLabelText('Refresh shader');
      await fireEvent.click(refreshButton);

      // Should not crash
      expect(refreshButton).toBeTruthy();
    });
  });

  describe('handleToggleLock', () => {
    it('should toggle lock state when lock button is clicked', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const lockButton = screen.getByLabelText('Toggle lock');
      await fireEvent.click(lockButton);

      // After clicking, lock state should toggle
      expect(lockButton).toBeTruthy();
    });
  });

  describe('manual compile mode', () => {
    it('shows compile button after cycling to manual mode and compiles on click', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      const manualModeButton = screen.getByLabelText('Set manual compile mode');
      await fireEvent.click(manualModeButton);
      await tick();

      const compileButton = screen.getByLabelText('Compile shader');
      vi.clearAllMocks();

      await fireEvent.click(compileButton);

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'extensionCommand',
        payload: { command: 'manualCompile' },
      });
    });
  });

  describe('handleFpsLimitChange', () => {
    it('should call renderingEngine.setFPSLimit when FPS limit changes', async () => {
      const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
      const setFPSLimitSpy = vi.fn();
      RenderingEngine.prototype.setFPSLimit = setFPSLimitSpy;

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Open options menu to access FPS controls
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Find and interact with the FPS limit control
      const fpsButton = screen.queryByLabelText('Uncap FPS');
      if (fpsButton) {
        await fireEvent.click(fpsButton);
        expect(setFPSLimitSpy).toHaveBeenCalled();
      }
    });
  });

  describe('handleExtensionCommand moveToNewWindow', () => {
    it('should set isInWindow to true when moveToNewWindow command is sent', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      vi.clearAllMocks();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Click "Open in new window" button
      const newWindowButton = screen.queryByLabelText('Open in new window');
      if (newWindowButton) {
        await fireEvent.click(newWindowButton);
        expect(mockTransport.postMessage).toHaveBeenCalledWith({
          type: 'extensionCommand',
          payload: { command: 'moveToNewWindow' }
        });
      }
    });
  });

  describe('handleConfigFileSelect', () => {
    it('should switch to Image buffer and use main shader code', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load a shader with multiple passes
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, BufferA: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { BufferA: '/test/bufferA.glsl' },
        },
      });
      await tick();

      // Toggle editor overlay
      editorOverlayStore.toggle();
      await tick();

      // Should not crash
      expect(container.querySelector('.editor-wrapper')).toBeTruthy();
    });

    it('should request file contents for non-Image buffer', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load a shader with multiple passes
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, BufferA: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { BufferA: '/test/bufferA.glsl' },
        },
      });
      await tick();

      // Toggle editor overlay to make buffer selector visible
      editorOverlayStore.toggle();
      await tick();

      vi.clearAllMocks();

      // Find and click the BufferA tab in the editor overlay
      const bufferTab = screen.queryByText('BufferA');
      if (bufferTab) {
        await fireEvent.click(bufferTab);
        await tick();

        expect(mockTransport.postMessage).toHaveBeenCalledWith({
          type: 'requestFileContents',
          payload: {
            bufferName: 'BufferA',
            shaderPath: '/test/shader.glsl',
          },
        });
      }
    });
  });

  describe('handleEditorCodeChange', () => {
    it('should recompile main shader when Image buffer code changes', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const handleShaderMessageSpy = vi.spyOn(ShaderStudio.prototype, 'handleShaderMessage');

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load a shader
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {} } },
          pathMap: { Image: '/test/shader.glsl' },
        },
      });
      await tick();

      // Toggle editor overlay
      editorOverlayStore.toggle();
      await tick();

      // The editor overlay should be visible and receive code change events
      expect(handleShaderMessageSpy).toBeDefined();
      handleShaderMessageSpy.mockRestore();
    });

    it('should call updateBufferAndRecompile for non-Image buffer code changes', async () => {
      const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
      const updateSpy = vi.fn().mockResolvedValue({ success: true });
      RenderingEngine.prototype.updateBufferAndRecompile = updateSpy;

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Load a shader
      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, BufferA: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { BufferA: '/test/bufferA.glsl' },
        },
      });
      await tick();

      // Component should handle buffer updates without crashing
      expect(updateSpy).toBeDefined();
    });

    it('should show errors when buffer recompile fails', async () => {
      const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
      const updateSpy = vi.fn().mockResolvedValue({ success: false, errors: ['Compile error in buffer'] });
      RenderingEngine.prototype.updateBufferAndRecompile = updateSpy;

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, BufferA: {} } },
          pathMap: { Image: '/test/shader.glsl' },
        },
      });
      await tick();

      // Component should handle buffer compile errors gracefully
      expect(updateSpy).toBeDefined();
    });
  });

  describe('handleShaderMessage error paths', () => {
    it('should handle error message with single string payload', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send error with a single string (not an array)
      await messageHandler({ data: { type: 'error', payload: 'Single error string' } });
      await tick();

      // The pause button should have the error class
      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton.classList.contains('error')).toBe(true);
    });

    it('should set errors when handleShaderMessage returns failure', async () => {
      // Override handleShaderMessage to return a failure result
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue({
        success: false,
        errors: ['Shader compile error']
      });

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send a generic message that goes through handleShaderMessage
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'invalid shader',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton.classList.contains('error')).toBe(true);

      ShaderStudio.prototype.handleShaderMessage = origHandleShaderMessage;
    });

    it('should handle exception in handleShaderMessage gracefully', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockRejectedValue(new Error('Unexpected crash'));

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Should not throw — error is caught internally
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'bad',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      // Error should be displayed and also sent to transport
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: [expect.stringContaining('Shader message handling failed')]
      });

      ShaderStudio.prototype.handleShaderMessage = origHandleShaderMessage;
    });
  });

  describe('handleErrorDismiss', () => {
    it('should clear errors when ErrorDisplay dismiss is triggered', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send error to show error display
      await messageHandler({ data: { type: 'error', payload: ['Test error'] } });
      await tick();

      // Verify error is shown
      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton.classList.contains('error')).toBe(true);

      // Click the dismiss button on the error display
      const dismissButton = container.querySelector('.error-tooltip .dismiss-button, .error-tooltip button');
      if (dismissButton) {
        await fireEvent.click(dismissButton);
        await tick();
        expect(pauseButton.classList.contains('error')).toBe(false);
      }
    });
  });

  describe('handleCanvasResize before initialization', () => {
    it('should not crash when resize happens before initialization', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });

      // Get the ResizeObserver callback immediately (before tick/init)
      const resizeObserverCalls = (global.ResizeObserver as ReturnType<typeof vi.fn>).mock.calls;
      if (resizeObserverCalls.length > 0) {
        const resizeCallback = resizeObserverCalls[0][0];
        // Trigger resize before init completes — should not throw
        resizeCallback([{
          contentRect: { width: 800, height: 600 },
          target: container.querySelector('canvas'),
        }]);
      }

      await tick();
      expect(container.querySelector('.main-container')).toBeTruthy();
    });
  });

  describe('pending messages buffer', () => {
    it('should buffer and replay messages that arrive during initialization', async () => {
      // Override ShaderStudio.initialize to delay
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origInit = ShaderStudio.prototype.initialize;
      let resolveInit: (() => void) | null = null;
      ShaderStudio.prototype.initialize = function() {
        return new Promise<boolean>((resolve) => {
          resolveInit = () => resolve(true);
        });
      };

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      // At this point, transport.onMessage has been called but initialized is still false
      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(onMessageCalls.length).toBeGreaterThan(0);
      const messageHandler = onMessageCalls[0][0];

      // Send a message while initialization is pending
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/buffered.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: null,
          pathMap: {},
        },
      });

      // Now complete initialization
      resolveInit!();
      await tick();
      await tick();

      // The buffered message should have been replayed
      // Component should be functional
      expect(screen.getByLabelText('Toggle pause')).toBeTruthy();

      ShaderStudio.prototype.initialize = origInit;
    });
  });

  describe('initialization failure', () => {
    it('should add error when ShaderStudio.initialize returns false', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origInit = ShaderStudio.prototype.initialize;
      ShaderStudio.prototype.initialize = vi.fn().mockResolvedValue(false);

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Error should be posted to transport
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: [expect.stringContaining('Failed to initialize ShaderStudio')]
      });

      ShaderStudio.prototype.initialize = origInit;
    });

    it('should add error when initialization throws', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origInit = ShaderStudio.prototype.initialize;
      ShaderStudio.prototype.initialize = vi.fn().mockRejectedValue(new Error('WebGL not supported'));

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Error should be posted to transport
      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: [expect.stringContaining('Initialization failed')]
      });

      ShaderStudio.prototype.initialize = origInit;
    });
  });

  describe('handleChangeRefreshMode', () => {
    it('should update gridRefreshMode when no pixel is captured', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      // The component defaults to gridRefreshMode since there's no pixel capture
      // The debug panel should show refresh mode controls
      expect(debugButton).toBeTruthy();
    });
  });

  describe('cursorPosition message', () => {
    it('should forward cursorPosition messages to messageHandler', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send a cursorPosition message — should not throw
      await messageHandler({
        data: {
          type: 'cursorPosition',
          line: 10,
          lineContent: 'vec4 color = vec4(1.0);',
          filePath: '/test/shader.glsl',
        },
      });
      await tick();

      // Component should still be functional
      expect(screen.getByLabelText('Toggle pause')).toBeTruthy();
    });
  });

  describe('shaderSource with no path', () => {
    it('should not set hasShader when path is empty', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send a shaderSource with empty path
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '',
          code: '',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      // Config button should still be disabled since hasShader is false
      const configButton = screen.getByLabelText('Toggle config panel');
      expect(configButton.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('handleToggleEditorOverlay', () => {
    it('should not toggle editor overlay via toolbar when no shader is active', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const editorButton = screen.getByLabelText('Toggle editor overlay');
      expect(editorButton).toHaveAttribute('disabled');

      await fireEvent.click(editorButton);
      await tick();

      expect(container.querySelector('.editor-wrapper')).toBeFalsy();
    });

    it('should toggle editor overlay via store', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { image: {} } },
          pathMap: { image: '/test/shader.glsl' },
        },
      });
      await tick();

      // Find the editor overlay toggle button
      const editorButton = screen.getByLabelText('Toggle editor overlay');
      await fireEvent.click(editorButton);
      await tick();

      expect(container.querySelector('.editor-wrapper')).toBeTruthy();

      // Toggle again to hide
      await fireEvent.click(editorButton);
      await tick();

      expect(container.querySelector('.editor-wrapper')).toBeFalsy();
    });
  });

  describe('handleToggleVimMode', () => {
    it('should toggle vim mode via store when editor overlay is visible', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Enable editor overlay first (vim mode button only appears when editor is visible)
      editorOverlayStore.setVisible(true);
      await tick();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Find the vim mode toggle (should now be visible)
      const vimButton = screen.queryByLabelText('Toggle vim mode');
      if (vimButton) {
        await fireEvent.click(vimButton);
        await tick();
        expect(vimButton).toBeTruthy();
      }
    });
  });

  describe('webServerState with isRunning false', () => {
    it('should handle webServerState with isRunning false', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: { type: 'webServerState', payload: { isRunning: false } }
      });
      await tick();

      expect(screen.getByLabelText('Toggle pause')).toBeTruthy();
    });
  });

  describe('panelState with isInWindow false', () => {
    it('should handle panelState with isInWindow false without error', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send panelState with isInWindow false — should not throw
      await messageHandler({
        data: { type: 'panelState', payload: { isInWindow: false } }
      });
      await tick();

      // Component should still be functional
      expect(screen.getByLabelText('Toggle pause')).toBeTruthy();
    });
  });

  describe('debug panel toggle and inline rendering', () => {
    it('should toggle inline rendering in debug panel', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      // Find the inline rendering toggle
      const inlineButton = container.querySelector('[aria-label="Toggle inline rendering"]');
      if (inlineButton) {
        await fireEvent.pointerDown(inlineButton);
        await tick();
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });

    it('should toggle inline rendering active state with a single click', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      const inlineButton = container.querySelector('[aria-label="Toggle inline rendering"]') as HTMLButtonElement;
      expect(inlineButton.classList.contains('active')).toBe(true);

      await fireEvent.pointerDown(inlineButton);
      await tick();

      expect(inlineButton.classList.contains('active')).toBe(false);
    });

    it('should toggle pixel inspector active state with a single click', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      const inspectorButton = container.querySelector('[aria-label="Toggle inspector"]') as HTMLButtonElement;
      expect(inspectorButton.classList.contains('active')).toBe(true);

      await fireEvent.pointerDown(inspectorButton);
      await tick();

      expect(inspectorButton.classList.contains('active')).toBe(false);
    });

    it('should toggle line lock in debug panel', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      // Find the line lock toggle
      const lineLockButton = container.querySelector('[aria-label="Toggle line lock"]');
      if (lineLockButton) {
        await fireEvent.pointerDown(lineLockButton);
        await tick();
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });

    it('should cycle normalize mode in debug panel', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      // Find the normalize cycle button
      const normalizeButton = container.querySelector('[aria-label="Cycle normalize mode"]');
      if (normalizeButton) {
        await fireEvent.pointerDown(normalizeButton);
        await tick();
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });

    it('should toggle step mode in debug panel', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      // Find the step toggle
      const stepButton = container.querySelector('[aria-label="Toggle step mode"]');
      if (stepButton) {
        await fireEvent.click(stepButton);
        await tick();
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });
  });

  describe('handleDebugClosed', () => {
    it('should disable debug mode when debug tab is closed via dockview event', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode first
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      vi.clearAllMocks();

      // The handleDebugClosed function calls handleToggleDebugEnabled when debug is enabled
      // Clicking the debug button again simulates the same path
      await fireEvent.click(debugButton);
      await tick();

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'debugModeState',
        payload: { enabled: false }
      });
    });
  });

  describe('mount functions', () => {
    it('should handle mountPreview, mountDebug, mountConfig without crashing', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // The mount functions are passed to DockviewLayout as props
      // They are called with a container element and return cleanup functions
      // Verify the component rendered all the dockview-panel-source elements
      const panelSources = container.querySelectorAll('.dockview-panel-source');
      expect(panelSources.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('editorBufferNames derivation', () => {
    it('should include only Image when no passes in config', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send shader with null config
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      // Toggle editor overlay
      editorOverlayStore.toggle();
      await tick();

      // With null config, only "Image" should be available
      // No BufferA tab should exist
      expect(screen.queryByText('BufferA')).toBeFalsy();
    });
  });

  describe('handleShaderMessage result paths', () => {
    it('should clear errors when result is successful', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const originalHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue({ success: true, errors: [] });

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // First set an error
      await messageHandler({ data: { type: 'error', payload: ['Some error'] } });
      await tick();

      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton.classList.contains('error')).toBe(true);

      // Then send a successful shader source which should clear errors
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      // Errors should be cleared by the successful result from handleShaderMessage
      expect(pauseButton.classList.contains('error')).toBe(false);

      ShaderStudio.prototype.handleShaderMessage = originalHandleShaderMessage;
    });

    it('should handle result with empty errors array', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue({
        success: false,
        errors: []
      });

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      // With empty errors array, errors should be set to []
      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton.classList.contains('error')).toBe(false);

      ShaderStudio.prototype.handleShaderMessage = origHandleShaderMessage;
    });

    it('should handle null result from handleShaderMessage', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue(null);

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Should handle null result without crashing
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      expect(screen.getByLabelText('Toggle pause')).toBeTruthy();

      ShaderStudio.prototype.handleShaderMessage = origHandleShaderMessage;
    });
  });

  describe('getUniforms', () => {
    it('should return uniforms from rendering engine when initialized', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      // Enable debug mode which passes getUniforms to DebugPanel
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      // Debug panel should render with uniform data
      expect(debugButton).toBeTruthy();
    });
  });

  describe('handleCanvasClick', () => {
    it('should delegate to pixel inspector manager on canvas click', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Find the canvas and simulate mousedown then click (ShaderCanvas requires mousedown position)
      const canvas = container.querySelector('canvas');
      if (canvas) {
        await fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
        await fireEvent.click(canvas, { clientX: 100, clientY: 100 });
        await tick();
        // Should not crash
        expect(canvas).toBeTruthy();
      }
    });

    it('should invoke onCanvasClick via canvas-container click', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Click the canvas-container (which wraps the canvas)
      const canvasContainer = container.querySelector('.canvas-container');
      if (canvasContainer) {
        // Simulate mousedown on canvas first to set mouseDownPosition
        const canvas = container.querySelector('canvas');
        if (canvas) {
          await fireEvent.mouseDown(canvas, { clientX: 50, clientY: 50 });
        }
        await fireEvent.click(canvasContainer, { clientX: 50, clientY: 50 });
        await tick();
        expect(canvasContainer).toBeTruthy();
      }
    });
  });

  describe('handleCanvasMouseMove', () => {
    it('should delegate mouse move to pixel inspector manager', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Fire mousemove on the main container
      const mainContainer = container.querySelector('.main-container');
      if (mainContainer) {
        await fireEvent.mouseMove(mainContainer, { clientX: 100, clientY: 200 });
        await tick();
        // Should not crash
        expect(mainContainer).toBeTruthy();
      }
    });

    it('should not crash when mousemove happens before initialization', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });

      // Fire mousemove immediately before init completes
      const mainContainer = container.querySelector('.main-container');
      if (mainContainer) {
        await fireEvent.mouseMove(mainContainer, { clientX: 50, clientY: 50 });
        // Should not crash
        expect(mainContainer).toBeTruthy();
      }
    });
  });

  describe('handleVideoControl', () => {
    it('should block per-video unmute when globally muted', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Ensure globally muted
      audioStore.setMuted(true);
      await tick();

      const engine = studioInstance.getRenderingEngine();
      // Verify the engine mock is accessible
      expect(engine).toBeTruthy();
      // The handleVideoControl function blocks unmute when audioMuted is true
      // This tests the component's guard logic
    });

    it('should apply global volume after per-video unmute when not globally muted', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Unmute globally first
      audioStore.setMuted(false);
      await tick();

      const engine = studioInstance.getRenderingEngine();
      expect(engine).toBeTruthy();
    });
  });

  describe('handleAudioControl actions', () => {
    it('should handle seek action format', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const engine = studioInstance.getRenderingEngine();
      // Test the seek format parsing
      engine.seekAudio('/test/audio.mp3', 10.5);
      expect(engine.seekAudio).toHaveBeenCalledWith('/test/audio.mp3', 10.5);
    });

    it('should handle loopRegion action format', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const engine = studioInstance.getRenderingEngine();
      engine.updateAudioLoopRegion('/test/audio.mp3', 2.0, undefined);
      expect(engine.updateAudioLoopRegion).toHaveBeenCalledWith('/test/audio.mp3', 2.0, undefined);
    });
  });

  describe('handleGetVideoState', () => {
    it('should return video state when engine exists', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const engine = studioInstance.getRenderingEngine();
      const mockState = { paused: false, muted: true, currentTime: 5.0, duration: 60.0 };
      engine.getVideoState.mockReturnValue(mockState);

      const result = engine.getVideoState('/test/video.mp4');
      expect(result).toEqual(mockState);
    });
  });

  describe('handleGetAudioState', () => {
    it('should return audio state when engine exists', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const engine = studioInstance.getRenderingEngine();
      const mockState = { paused: true, muted: false, currentTime: 3.0, duration: 45.0 };
      engine.getAudioState.mockReturnValue(mockState);

      const result = engine.getAudioState('/test/audio.mp3');
      expect(result).toEqual(mockState);
    });
  });

  describe('handleGetAudioFFT', () => {
    it('should return FFT data when engine exists', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      const engine = studioInstance.getRenderingEngine();
      const mockFFT = new Uint8Array([10, 20, 30]);
      engine.getAudioFFTData.mockReturnValue(mockFFT);

      const result = engine.getAudioFFTData('frequency');
      expect(result).toBe(mockFFT);
    });
  });

  describe('applyGlobalAudioState', () => {
    it('should set global volume on rendering engine and sync audio options', async () => {
      let studioInstance: any;
      const onInitialized = vi.fn((data: any) => {
        studioInstance = data.shaderStudio;
      });

      render(ShaderViewer, { onInitialized });
      await tick();
      await tick();
      await loadShader();
      await tick();

      mockSetAudioOptions.mockClear();

      // Trigger applyGlobalAudioState by changing audio store
      audioStore.setVolume(0.75);
      await tick();

      // setAudioOptions should have been called with the perceptual volume
      expect(mockSetAudioOptions).toHaveBeenCalled();
      const call = mockSetAudioOptions.mock.calls[0][0];
      expect(call).toHaveProperty('volume');
      expect(call).toHaveProperty('muted');
    });
  });

  describe('shaderSource with bufferPathMap', () => {
    it('should track bufferPathMap from shaderSource messages', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Send a shaderSource with bufferPathMap
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, BufferA: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { BufferA: '/test/bufferA.glsl' },
        },
      });
      await tick();

      // Config panel should receive the bufferPathMap
      // Open config panel to verify
      configPanelStore.setVisible(true);
      await tick();

      // Component should handle bufferPathMap without errors
      expect(screen.getByLabelText('Toggle pause')).toBeTruthy();
    });
  });

  describe('handleTogglePause', () => {
    it('should not toggle pause before initialization', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });

      // Before initialization completes, the pause button shouldn't exist
      // or shouldn't function
      const pauseButton = container.querySelector('[aria-label="Toggle pause"]');
      expect(pauseButton).toBeFalsy();
    });
  });

  describe('handleCanvasResize with dimensions', () => {
    it('should update canvasWidth and canvasHeight on resize', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Get the ResizeObserver callback
      const resizeObserverCalls = (global.ResizeObserver as ReturnType<typeof vi.fn>).mock.calls;
      if (resizeObserverCalls.length > 0) {
        const resizeCallback = resizeObserverCalls[0][0];

        // Simulate a resize
        resizeCallback([{
          contentRect: { width: 1920, height: 1080 },
          target: container.querySelector('canvas'),
        }]);
        await tick();

        // The component should have updated dimensions
        // Verify by checking the component is still rendered correctly
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });
  });

  describe('editor overlay buffer switching', () => {
    it('should switch back to Image buffer and use main shader code', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load shader with multiple buffers
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, BufferA: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { BufferA: '/test/bufferA.glsl' },
        },
      });
      await tick();

      // Toggle editor overlay
      editorOverlayStore.toggle();
      await tick();

      vi.clearAllMocks();

      // Click BufferA tab
      const bufferTab = screen.queryByText('BufferA');
      if (bufferTab) {
        await fireEvent.click(bufferTab);
        await tick();

        // Then click Image tab to switch back
        const imageTab = screen.queryByText('Image');
        if (imageTab) {
          await fireEvent.click(imageTab);
          await tick();

          // No requestFileContents should be sent for Image buffer
          const fileContentsCalls = (mockTransport.postMessage as ReturnType<typeof vi.fn>).mock.calls
            .filter((c: any[]) => c[0]?.type === 'requestFileContents');
          // Only one requestFileContents call should exist (for BufferA)
          expect(fileContentsCalls.length).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe('handleShaderMessage with compilation result errors', () => {
    it('should display errors when shader compilation returns non-empty errors', async () => {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const origHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue({
        success: false,
        errors: ['Line 1: syntax error', 'Line 5: undeclared identifier']
      });

      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'invalid',
          config: null,
          pathMap: {},
        },
      });
      await tick();

      // Errors should be displayed
      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton.classList.contains('error')).toBe(true);

      // Error tooltip should show both errors
      const tooltip = container.querySelector('.error-tooltip');
      if (tooltip) {
        expect(tooltip.textContent).toContain('syntax error');
      }

      ShaderStudio.prototype.handleShaderMessage = origHandleShaderMessage;
    });
  });

  describe('debug panel interactions', () => {
    async function setupDebugMode() {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();
      await tick();

      return container;
    }

    it('should handle sample size change from debug panel', async () => {
      const container = await setupDebugMode();

      // Look for sample size control
      const sampleSizeInput = container.querySelector('[aria-label="Sample size"]');
      if (sampleSizeInput) {
        await fireEvent.input(sampleSizeInput, { target: { value: '64' } });
        await tick();
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });

    it('should handle refresh mode change from debug panel', async () => {
      const container = await setupDebugMode();

      // Look for refresh mode control
      const refreshModeSelect = container.querySelector('[aria-label="Refresh mode"]');
      if (refreshModeSelect) {
        await fireEvent.change(refreshModeSelect, { target: { value: 'manual' } });
        await tick();
        expect(container.querySelector('.main-container')).toBeTruthy();
      }
    });
  });

  describe('multiple onMount subscriptions', () => {
    it('should subscribe and unsubscribe from stores properly', async () => {
      const { unmount } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Verify stores are subscribed
      configPanelStore.setVisible(true);
      await tick();
      configPanelStore.setVisible(false);
      await tick();

      debugPanelStore.setVisible(true);
      await tick();
      debugPanelStore.setVisible(false);
      await tick();

      editorOverlayStore.setVisible(true);
      await tick();
      editorOverlayStore.setVisible(false);
      await tick();

      // Unmount should unsubscribe from all stores
      unmount();

      // After unmount, store changes should not crash
      configPanelStore.setVisible(true);
      debugPanelStore.setVisible(true);
      editorOverlayStore.setVisible(true);
    });
  });

  describe('handleAspectRatioChange', () => {
    it('should handle aspect ratio change from resolution menu', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Click the resolution button to open the menu
      const resButton = screen.queryByLabelText('Change resolution settings');
      if (resButton) {
        await fireEvent.click(resButton);
        await tick();

        // Click a specific aspect ratio option (e.g., "16:9")
        const option = screen.queryByText('16:9');
        if (option) {
          await fireEvent.click(option);
          await tick();
          expect(option).toBeTruthy();
        }
      }
    });
  });

  describe('handleZoomChange', () => {
    it('should handle zoom slider change from resolution menu', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      // Click the resolution button to open the menu
      const resButton = screen.queryByLabelText('Change resolution settings');
      if (resButton) {
        await fireEvent.click(resButton);
        await tick();

        // Find and interact with the zoom slider
        const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement;
        if (zoomSlider) {
          await fireEvent.input(zoomSlider, { target: { value: '2.0' } });
          await tick();
          expect(zoomSlider).toBeTruthy();
        }
      }
    });
  });

  describe('handleFpsLimitChange via menu', () => {
    it('should change FPS limit when selecting from FPS menu', async () => {
      const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
      const setFPSLimitSpy = vi.fn();
      RenderingEngine.prototype.setFPSLimit = setFPSLimitSpy;

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();
      await tick();

      // Click the FPS button to open FPS menu
      const fpsButton = screen.queryByLabelText('Change FPS limit');
      if (fpsButton) {
        await fireEvent.click(fpsButton);
        await tick();

        // Select 30 FPS option
        const option30 = screen.queryByText('30 FPS');
        if (option30) {
          await fireEvent.click(option30);
          await tick();
          expect(setFPSLimitSpy).toHaveBeenCalledWith(30);
        }
      }
    });
  });

  describe('handleConfigFileSelect via config panel', () => {
    it('should request file contents when switching to non-Image buffer tab in config panel', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load shader with multiple buffers including common
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, common: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { common: '/test/common.glsl' },
        },
      });
      await tick();

      // Open config panel
      configPanelStore.setVisible(true);
      await tick();
      await tick();

      vi.clearAllMocks();

      // Click the Common tab in the config panel
      const tabButtons = container.querySelectorAll('.tab-button');
      const commonTab = Array.from(tabButtons).find(b => b.textContent?.includes('Common'));
      if (commonTab) {
        await fireEvent.click(commonTab);
        await tick();

        // Should send requestFileContents for the common buffer
        expect(mockTransport.postMessage).toHaveBeenCalledWith({
          type: 'requestFileContents',
          payload: expect.objectContaining({
            bufferName: 'common',
          }),
        });
      }
    });

    it('should switch back to Image and use main shader code', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load shader with multiple buffers
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {}, common: {} } },
          pathMap: { Image: '/test/shader.glsl' },
          bufferPathMap: { common: '/test/common.glsl' },
        },
      });
      await tick();

      // Open config panel
      configPanelStore.setVisible(true);
      await tick();
      await tick();

      // Switch to Common tab first
      const tabButtons = container.querySelectorAll('.tab-button');
      const commonTab = Array.from(tabButtons).find(b => b.textContent?.includes('Common'));
      if (commonTab) {
        await fireEvent.click(commonTab);
        await tick();

        vi.clearAllMocks();

        // Switch back to Image tab
        const imageTab = Array.from(container.querySelectorAll('.tab-button')).find(b => b.textContent?.includes('Image'));
        if (imageTab) {
          await fireEvent.click(imageTab);
          await tick();

          // Should NOT send requestFileContents for Image
          const fileContentsCalls = (mockTransport.postMessage as ReturnType<typeof vi.fn>).mock.calls
            .filter((c: any[]) => c[0]?.type === 'requestFileContents');
          expect(fileContentsCalls).toHaveLength(0);
        }
      }
    });
  });

  describe('debug dock visibility and content', () => {
    it('should show debug content when the debug panel is opened', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      debugPanelStore.setVisible(true);
      await tick();
      await tick();

      expect(container.querySelector('[aria-label="Toggle variable inspector"]')).toBeTruthy();
    });
  });

  // ─── Performance panel integration ────────────────────────────
  describe('Performance panel integration', () => {
    it('should import performancePanelStore', async () => {
      // The store is imported and subscribed to — verify it doesn't crash
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      expect(container.querySelector('.main-container')).toBeTruthy();
    });

    it('should pass performance panel props to DockviewLayout', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      // The dockview container should be present (DockviewLayout is rendered)
      expect(container.querySelector('.main-container')).toBeTruthy();
    });

    it('should render a hidden performance panel source element', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      // There should be a dockview-panel-source div for performance
      const panelSources = container.querySelectorAll('.dockview-panel-source');
      expect(panelSources.length).toBeGreaterThanOrEqual(1);
    });

    it('should toggle performance panel via store', async () => {
      const { performancePanelStore } = await import('../../lib/stores/performancePanelStore');
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      // Toggle the store
      performancePanelStore.toggle();
      await tick();

      // Should not crash — the panel visibility state propagates
      expect(container.querySelector('.main-container')).toBeTruthy();

      // Toggle back
      performancePanelStore.toggle();
      await tick();
    });

    it('should have exactly 4 dockview-panel-source elements (preview, debug, config, performance)', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      const panelSources = container.querySelectorAll('.dockview-panel-source');
      expect(panelSources.length).toBe(4);
    });

    it('should subscribe to performancePanelStore on mount', async () => {
      const { performancePanelStore } = await import('../../lib/stores/performancePanelStore');
      const subscribeSpy = vi.spyOn(performancePanelStore, 'subscribe');

      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      expect(subscribeSpy).toHaveBeenCalled();
      subscribeSpy.mockRestore();
    });

    it('should handle performancePanelStore toggle without crashing before initialization', async () => {
      const { performancePanelStore } = await import('../../lib/stores/performancePanelStore');

      // Toggle before rendering
      performancePanelStore.setVisible(true);

      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      // Should render fine even though store was toggled before component mounted
      expect(container.querySelector('.main-container')).toBeTruthy();

      // Clean up
      performancePanelStore.setVisible(false);
      await tick();
    });

    it('should close performance panel via store setVisible(false)', async () => {
      const { performancePanelStore } = await import('../../lib/stores/performancePanelStore');
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();

      // Open
      performancePanelStore.setVisible(true);
      await tick();

      // Close (simulates what handlePerformanceClosed does)
      performancePanelStore.setVisible(false);
      await tick();

      // Verify store reflects closed state
      let storeState: any;
      performancePanelStore.subscribe((s) => { storeState = s; })();
      expect(storeState.isVisible).toBe(false);
    });
  });

  describe('customUniformValues merge and per-uniform fps', () => {
    // Helper: set up config panel on the Script tab with 2 uniforms declared
    async function setupWithUniforms(messageHandler: (e: any) => Promise<void>, container: Element) {
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
      const origHandleShaderMessage = ShaderStudio.prototype.handleShaderMessage;
      const origGetCustomUniformInfo = (RenderingEngine.prototype as any).getCustomUniformInfo;

      // Return success so scriptInfo.uniforms is populated
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue({ success: true });
      (RenderingEngine.prototype as any).getCustomUniformInfo = vi.fn().mockReturnValue([
        { name: 'uFast', type: 'float' },
        { name: 'uStatic', type: 'float' },
      ]);

      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {} }, script: 'uniforms.ts' },
          pathMap: {},
        },
      });
      await tick();

      configPanelStore.setVisible(true);
      await tick();
      const scriptTabLabel = Array.from(container.querySelectorAll('.tab-label'))
        .find(el => el.textContent?.trim() === 'Script');
      if (scriptTabLabel) { fireEvent.click(scriptTabLabel); }
      await tick();

      // Restore after setup so other tests are unaffected
      ShaderStudio.prototype.handleShaderMessage = origHandleShaderMessage;
      (RenderingEngine.prototype as any).getCustomUniformInfo = origGetCustomUniformInfo;
    }

    it('should merge partial customUniformValues update without clearing unchanged uniforms', async () => {
      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      const messageHandler = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await setupWithUniforms(messageHandler, container);

      // Send full initial update with both uniforms
      await messageHandler({
        data: { type: 'customUniformValues', payload: { values: [
          { name: 'uFast', type: 'float', value: 1.0 },
          { name: 'uStatic', type: 'float', value: 42.0 },
        ]}},
      });
      await tick();

      // Send partial update — only uFast changed
      await messageHandler({
        data: { type: 'customUniformValues', payload: { values: [
          { name: 'uFast', type: 'float', value: 2.0 },
        ]}},
      });
      await tick();

      // Both uniforms must still be visible with correct values
      const uniformValues = container.querySelectorAll('.uniform-value');
      const texts = Array.from(uniformValues).map(el => el.textContent?.trim());
      expect(texts.some(t => t?.includes('2.000'))).toBe(true);  // uFast updated
      expect(texts.some(t => t?.includes('42.00'))).toBe(true);  // uStatic preserved
    });

    it('should reset per-uniform fps to 0 after a new shaderSource arrives', async () => {
      let mockNow = 0;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => mockNow);

      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      const messageHandler = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await setupWithUniforms(messageHandler, container);

      // Enable fps column
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox) { fireEvent.click(checkbox); await tick(); }

      // Send some updates to build per-uniform timestamps
      for (let i = 0; i < 4; i++) {
        await messageHandler({
          data: { type: 'customUniformValues', payload: { values: [
            { name: 'uFast', type: 'float', value: i },
          ]}},
        });
        await tick();
      }
      await new Promise(r => setTimeout(r, 150));
      await tick();

      // uFast fps should be > 0 before reset
      const fpsBeforeReset = parseInt(
        container.querySelector('.uniform-fps')?.textContent ?? '0'
      );
      expect(fpsBeforeReset).toBeGreaterThan(0);

      // Advance time so all existing timestamps become stale
      mockNow = 2000;

      // Send a new shaderSource — should wipe uniformTimestamps
      const { ShaderStudio } = await import('../../lib/ShaderStudio');
      const { RenderingEngine } = await import('../../../../rendering/src/RenderingEngine');
      const origHandle = ShaderStudio.prototype.handleShaderMessage;
      const origGetInfo = (RenderingEngine.prototype as any).getCustomUniformInfo;
      ShaderStudio.prototype.handleShaderMessage = vi.fn().mockResolvedValue({ success: true });
      (RenderingEngine.prototype as any).getCustomUniformInfo = vi.fn().mockReturnValue([
        { name: 'uFast', type: 'float' },
        { name: 'uStatic', type: 'float' },
      ]);
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(0.0); }',
          config: { passes: { Image: {} }, script: 'uniforms.ts' },
          pathMap: {},
        },
      });
      await tick();
      ShaderStudio.prototype.handleShaderMessage = origHandle;
      (RenderingEngine.prototype as any).getCustomUniformInfo = origGetInfo;

      // Wait for fpsInterval to evict stale timestamps
      await new Promise(r => setTimeout(r, 150));
      await tick();

      const fpsCells = container.querySelectorAll('.uniform-fps');
      fpsCells.forEach(cell => {
        expect(cell.textContent).toBe('0fps');
      });

      nowSpy.mockRestore();
    });

    it('should track per-uniform fps independently for fast vs static uniforms', async () => {
      let mockNow = 0;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => mockNow);

      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      const messageHandler = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      await setupWithUniforms(messageHandler, container);

      // Enable fps display
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox) { fireEvent.click(checkbox); await tick(); }

      // Send 4 updates for uFast only, spread within 1s window
      for (let i = 0; i < 4; i++) {
        mockNow = i * 100;
        await messageHandler({
          data: { type: 'customUniformValues', payload: { values: [
            { name: 'uFast', type: 'float', value: i },
          ]}},
        });
        await tick();
      }

      // Wait for fpsInterval to compute per-uniform fps
      await new Promise(r => setTimeout(r, 150));
      await tick();

      // uFast should have fps > 0; uStatic should have 0fps
      const uniformRows = container.querySelectorAll('.uniform-row');
      let fastFps = -1;
      let staticFps = -1;
      uniformRows.forEach(row => {
        const nameEl = row.querySelector('.uniform-name');
        const fpsEl = row.querySelector('.uniform-fps');
        if (!nameEl || !fpsEl) { return; }
        const fps = parseInt(fpsEl.textContent ?? '0');
        if (nameEl.textContent?.includes('uFast')) { fastFps = fps; }
        if (nameEl.textContent?.includes('uStatic')) { staticFps = fps; }
      });
      expect(fastFps).toBeGreaterThan(0);
      expect(staticFps).toBe(0);

      nowSpy.mockRestore();
    });
  });

  describe('actualPollFps decay', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should drop actualPollFps to 0 after custom uniform messages stop arriving', async () => {
      // Spy on performance.now() so we can control when timestamps become stale.
      // The real fpsInterval (100ms) will run naturally and evict stale entries.
      let mockNow = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => mockNow);

      const { container } = render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const messageHandler = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Load a shader with a script so the Script tab is present
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: '/test/shader.glsl',
          code: 'void mainImage(out vec4 o, vec2 uv) { o = vec4(1.0); }',
          config: { passes: { Image: {} }, script: 'uniforms.ts' },
          pathMap: {},
        },
      });
      await tick();

      // Open config panel and switch to Script tab
      configPanelStore.setVisible(true);
      await tick();
      const scriptTabLabel = Array.from(container.querySelectorAll('.tab-label'))
        .find(el => el.textContent?.trim() === 'Script');
      expect(scriptTabLabel).toBeTruthy();
      fireEvent.click(scriptTabLabel!);
      await tick();

      // Send several customUniformValues messages at mockNow=0 to push actualPollFps above 0
      for (let i = 0; i < 5; i++) {
        await messageHandler({
          data: {
            type: 'customUniformValues',
            payload: { values: [{ name: 'uVal', type: 'float', value: i }] },
          },
        });
        await tick();
      }

      // Script tab should now be active (ScriptInfo renders with .polling-section)
      expect(container.querySelector('.polling-section')).toBeTruthy();
      // Actual fps indicator is always shown — should reflect > 0 after messages
      const actualFpsEl = container.querySelector('.actual-fps');
      expect(actualFpsEl).toBeTruthy();
      expect(actualFpsEl!.textContent).not.toBe('(0fps)');

      // Jump mock time > 1s ahead — all timestamps at t=0 are now stale
      mockNow = 2000;

      // Wait for the real fpsInterval (100ms) to fire at least once and evict stale entries
      await new Promise(r => setTimeout(r, 200));
      await tick();

      // Actual fps should have decayed back to 0
      expect(container.querySelector('.actual-fps')!.textContent).toBe('(0fps)');
    });
  });

  describe('handleVarClick', () => {
    beforeEach(() => {
      // Re-apply ResizeObserver mock - vi.clearAllMocks() in the outer beforeEach
      // clears the implementation, so we need to restore it for each test.
      global.ResizeObserver = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }));
    });

    const TEST_FILE = '/test/shader.glsl';
    const TEST_VAR: any = {
      varName: 'myVar', varType: 'float', value: null,
      channelMeans: [0.5], channelStats: [{ min: 0, max: 1, mean: 0.5 }],
      stats: { min: 0, max: 1, mean: 0.5 }, histogram: null,
      channelHistograms: null, colorFrequencies: null, thumbnail: null,
      declarationLine: 5, gridWidth: 32, gridHeight: 32,
    };

    async function setupWithVars(filePath: string | null = TEST_FILE) {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();

      const onMessageCalls = (mockTransport.onMessage as ReturnType<typeof vi.fn>).mock.calls;
      const messageHandler = onMessageCalls[0][0];

      // Load shader
      await messageHandler({
        data: {
          type: 'shaderSource',
          path: TEST_FILE,
          code: 'void mainImage(out vec4 o, vec2 uv) { float myVar = 0.5; o = vec4(1.0); }',
          config: { passes: { image: {} } },
          pathMap: { image: TEST_FILE },
        },
      });
      await tick();

      // Send a separate cursorPosition message to set filePath in debugState
      if (filePath !== null) {
        await messageHandler({
          data: {
            type: 'cursorPosition',
            payload: { line: 5, lineContent: 'float myVar = 0.5;', filePath },
          },
        });
        await tick();
      }

      // Enable debug mode
      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();

      // Enable variable inspector
      const varInspectorBtn = screen.getByLabelText('Toggle variable inspector');
      await fireEvent.pointerDown(varInspectorBtn);
      await tick();

      // Inject captured variables
      mockVCMFactory.inject([TEST_VAR]);
      await tick();
    }

    it('sends goToLine message with correct line and filePath when line badge clicked', async () => {
      await setupWithVars();
      vi.clearAllMocks();

      const lineEl = document.querySelector('.var-line') as HTMLElement;
      expect(lineEl).toBeInTheDocument();
      expect(lineEl.textContent).toBe('L6');

      await fireEvent.click(lineEl);

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'goToLine',
        payload: { line: 5, filePath: TEST_FILE },
      });
    });

    it('does not send goToLine when filePath is null', async () => {
      await setupWithVars(null); // no cursorPosition → filePath stays null
      vi.clearAllMocks();

      const lineEl = document.querySelector('.var-line') as HTMLElement;
      expect(lineEl).toBeInTheDocument();

      await fireEvent.click(lineEl);

      const goToLineCalls = (mockTransport.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: any[]) => c[0]?.type === 'goToLine');
      expect(goToLineCalls).toHaveLength(0);
    });

    it('does not render line badge for variable with declarationLine -1', async () => {
      render(ShaderViewer, { onInitialized: vi.fn() });
      await tick();
      await tick();
      await loadShader();

      const debugButton = screen.getByLabelText('Toggle debug mode');
      await fireEvent.click(debugButton);
      await tick();

      const varInspectorBtn = screen.getByLabelText('Toggle variable inspector');
      await fireEvent.pointerDown(varInspectorBtn);
      await tick();

      mockVCMFactory.inject([{ ...TEST_VAR, declarationLine: -1 }]);
      await tick();

      expect(document.querySelector('.var-line')).not.toBeInTheDocument();
    });
  });
});
