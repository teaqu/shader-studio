// @vitest-environment jsdom
import { render, fireEvent, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import DebugPanel from '../../../lib/components/debug/DebugPanel.svelte';
import type { ShaderDebugState, DebugFunctionContext } from '../../../lib/types/ShaderDebugState';
import type { PassUniforms } from '../../../../../rendering/src/models/PassUniforms';
import type { RefreshMode } from '../../../lib/VariableCaptureManager';
import type { ShaderDebugManager } from '../../../lib/ShaderDebugManager';
import type { VariableCaptureManager } from '../../../lib/VariableCaptureManager';

function makeDebugState(overrides: Partial<ShaderDebugState> = {}): ShaderDebugState {
  return {
    isEnabled: true,
    currentLine: 5,
    lineContent: 'float d = length(p) - r;',
    filePath: '/test.glsl',
    isActive: true,
    functionContext: null,
    isLineLocked: false,
    isInlineRenderingEnabled: true,
    normalizeMode: 'off' as const,
    isStepEnabled: false,
    stepEdge: 0.5,
    debugError: null,
    isVariableInspectorEnabled: false,
    capturedVariables: [],
    ...overrides,
  };
}

function makeFunctionContext(overrides: Partial<DebugFunctionContext> = {}): DebugFunctionContext {
  return {
    functionName: 'sdf',
    returnType: 'float',
    parameters: [
      { name: 'p', type: 'vec2', uvValue: 'uv', centeredUvValue: '((fragCoord * 2.0 - iResolution.xy) / iResolution.y)', defaultCustomValue: 'vec2(0.5)', mode: 'uv', customValue: 'vec2(0.5)' },
      { name: 'r', type: 'float', uvValue: 'uv.x', centeredUvValue: '((fragCoord * 2.0 - iResolution.xy) / iResolution.y).x', defaultCustomValue: '0.5', mode: 'custom', customValue: '0.5' },
    ],
    isFunction: true,
    loops: [],
    ...overrides,
  };
}

const mockUniforms: PassUniforms = {
  time: 1.5,
  res: [800, 600, 1],
  mouse: [400, 300, 0, 0],
  frame: 90,
  timeDelta: 0.0167,
  frameRate: 60.0,
  date: [2024, 1, 15, 12345.0],
  channelTime: [0, 0, 0, 0],
  sampleRate: 44100,
  channelLoaded: [0, 0, 0, 0],
  cameraPos: [0, 0, 5],
  cameraDir: [0, 0, -1],
};

function mockGetUniforms(): PassUniforms | null {
  return mockUniforms;
}

function createMockShaderDebugManager() {
  return {
    setCustomParameter: vi.fn(),
    setLoopMaxIterations: vi.fn(),
    toggleLineLock: vi.fn(),
    toggleInlineRendering: vi.fn(),
    cycleNormalizeMode: vi.fn(),
    toggleStep: vi.fn(),
    setStepEdge: vi.fn(),
    toggleVariableInspector: vi.fn(),
  } as unknown as ShaderDebugManager;
}

function createMockVariableCaptureManager() {
  return {
    changeSampleSize: vi.fn(),
    changeRefreshMode: vi.fn(),
    changePollingMs: vi.fn(),
    sampleSize: 32,
    getActiveRefreshMode: vi.fn().mockReturnValue('polling'),
    getActivePollingMs: vi.fn().mockReturnValue(500),
  } as unknown as VariableCaptureManager;
}

describe('DebugPanel', () => {
  it('renders header with inspector and inline rendering buttons', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
    });

    const inspectorBtn = container.querySelector('[aria-label="Toggle inspector"]');
    const inlineBtn = container.querySelector('[aria-label="Toggle inline rendering"]');

    expect(inspectorBtn).toBeTruthy();
    expect(inlineBtn).toBeTruthy();
  });

  it('uses explicit variable capture loading and error state', () => {
    const { getByText, queryByText } = render(DebugPanel, {
      debugState: makeDebugState({
        isVariableInspectorEnabled: true,
        capturedVariables: [],
      }),
      getUniforms: mockGetUniforms,
      isVariableCaptureLoading: false,
      variableCaptureError: 'Failed to capture variables',
    });

    expect(getByText('Failed to capture variables')).toBeInTheDocument();
    expect(queryByText('Capturing...')).not.toBeInTheDocument();
  });

  it('shows line number and function name when inline rendering is on and context exists', () => {
    const ctx = makeFunctionContext();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: ctx }),
      getUniforms: mockGetUniforms,
    });

    // currentLine is 5 (0-indexed), displayed as L6
    expect(container.querySelector('.header-info')?.textContent).toContain('L6');
    expect(container.querySelector('.fn-name')?.textContent).toBe('sdf');
    expect(container.querySelector('.fn-type')?.textContent).toBe('float');
  });

  it('shows parameter editors when in non-mainImage function with params', () => {
    const ctx = makeFunctionContext();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: ctx }),
      getUniforms: mockGetUniforms,
    });

    const sectionLabels = container.querySelectorAll('.section-label');
    const labelTexts = Array.from(sectionLabels).map(el => el.textContent);
    expect(labelTexts).toContain('Parameters');
  });

  it('shows loop controls with line number prefixes', () => {
    const ctx = makeFunctionContext({
      loops: [
        {
          loopIndex: 0,
          lineNumber: 10,
          endLine: 15,
          loopHeader: 'for (int i = 0; i < 10; i++)',
          maxIter: null,
        },
        {
          loopIndex: 1,
          lineNumber: 20,
          endLine: 25,
          loopHeader: 'for (int j = 0; j < 5; j++)',
          maxIter: 3,
        },
      ],
    });

    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: ctx }),
      getUniforms: mockGetUniforms,
    });

    const sectionLabels = container.querySelectorAll('.section-label');
    const labelTexts = Array.from(sectionLabels).map(el => el.textContent);
    expect(labelTexts).toContain('Loops');

    const loopLines = container.querySelectorAll('.loop-line');
    expect(loopLines.length).toBe(2);
    // lineNumber is 0-indexed, displayed +1
    expect(loopLines[0].textContent).toBe('L11:');
    expect(loopLines[1].textContent).toBe('L21:');

    const loopHeaders = container.querySelectorAll('.loop-header');
    expect(loopHeaders[0].textContent).toBe('for (int i = 0; i < 10; i++)');
    expect(loopHeaders[1].textContent).toBe('for (int j = 0; j < 5; j++)');
  });

  it('shows line content in line number tooltip when debugState.lineContent is set', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ lineContent: 'float d = length(p) - r;' }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info');
    expect(lineInfo).toBeTruthy();
    expect(lineInfo?.getAttribute('data-tooltip')).toBe('float d = length(p) - r;');
  });

  it('hides params/loops when inline rendering is off', () => {
    const ctx = makeFunctionContext({
      loops: [
        {
          loopIndex: 0,
          lineNumber: 10,
          endLine: 15,
          loopHeader: 'for (int i = 0; i < 10; i++)',
          maxIter: null,
        },
      ],
    });

    const { container } = render(DebugPanel, {
      debugState: makeDebugState({
        functionContext: ctx,
        isInlineRenderingEnabled: false,
      }),
      getUniforms: mockGetUniforms,
    });

    const sectionLabels = container.querySelectorAll('.section-label');
    const labelTexts = Array.from(sectionLabels).map(el => el.textContent);
    expect(labelTexts).not.toContain('Parameters');
    expect(labelTexts).not.toContain('Loops');
  });

  it('uniforms section always visible even when inline rendering is off', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isInlineRenderingEnabled: false }),
      getUniforms: mockGetUniforms,
    });

    const sectionLabels = container.querySelectorAll('.section-label');
    const labelTexts = Array.from(sectionLabels).map(el => el.textContent);
    expect(labelTexts).toContain('Uniforms');
  });

  it('lock button toggles active state', async () => {
    const mockDebugManager = createMockShaderDebugManager();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isLineLocked: false }),
      getUniforms: mockGetUniforms,
      shaderDebugManager: mockDebugManager,
    });

    const lockBtn = container.querySelector('[aria-label="Toggle line lock"]') as HTMLElement;
    expect(lockBtn).toBeTruthy();
    expect(lockBtn.classList.contains('active')).toBe(false);

    await fireEvent.pointerDown(lockBtn);
    expect(mockDebugManager.toggleLineLock).toHaveBeenCalledOnce();
  });

  it('does not invoke a header action twice for duplicate pointerdown events from the same pointer', async () => {
    const mockDebugManager = createMockShaderDebugManager();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isLineLocked: false }),
      getUniforms: mockGetUniforms,
      shaderDebugManager: mockDebugManager,
    });

    const lockBtn = container.querySelector('[aria-label="Toggle line lock"]') as HTMLElement;
    expect(lockBtn).toBeTruthy();

    await fireEvent.pointerDown(lockBtn, { pointerId: 7, button: 0, isPrimary: true });
    await fireEvent.pointerDown(lockBtn, { pointerId: 7, button: 0, isPrimary: true });

    expect(mockDebugManager.toggleLineLock).toHaveBeenCalledTimes(1);

    await fireEvent.pointerUp(window, { pointerId: 7, button: 0, isPrimary: true });
    await fireEvent.pointerDown(lockBtn, { pointerId: 7, button: 0, isPrimary: true });

    expect(mockDebugManager.toggleLineLock).toHaveBeenCalledTimes(2);
  });

  it('lock button shows active state when locked', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isLineLocked: true }),
      getUniforms: mockGetUniforms,
    });

    const lockBtn = container.querySelector('[aria-label="Toggle line lock"]') as HTMLElement;
    expect(lockBtn.classList.contains('active')).toBe(true);
  });

  it('inline rendering toggle button present and clickable', async () => {
    const onToggleInlineRendering = vi.fn();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
      onToggleInlineRendering,
    });

    const inlineBtn = container.querySelector('[aria-label="Toggle inline rendering"]') as HTMLElement;
    expect(inlineBtn).toBeTruthy();

    await fireEvent.pointerDown(inlineBtn);
    expect(onToggleInlineRendering).toHaveBeenCalledOnce();
  });

  it('inspector toggle button present and clickable', async () => {
    const onToggleInspectorEnabled = vi.fn();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
      onToggleInspectorEnabled,
    });

    const inspectorBtn = container.querySelector('[aria-label="Toggle inspector"]') as HTMLElement;
    expect(inspectorBtn).toBeTruthy();

    await fireEvent.pointerDown(inspectorBtn);
    expect(onToggleInspectorEnabled).toHaveBeenCalledOnce();
  });

  it('shows normalize button when inline rendering is on', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isInlineRenderingEnabled: true }),
      getUniforms: mockGetUniforms,
    });

    const normalizeBtn = container.querySelector('[aria-label="Cycle normalize mode"]');
    expect(normalizeBtn).toBeTruthy();
  });

  it('shows normalize button even when inline rendering is off', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isInlineRenderingEnabled: false }),
      getUniforms: mockGetUniforms,
    });

    const normalizeBtn = container.querySelector('[aria-label="Cycle normalize mode"]');
    expect(normalizeBtn).toBeTruthy();
  });

  it('normalize button calls cycleNormalizeMode on manager', async () => {
    const mockDebugManager = createMockShaderDebugManager();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
      shaderDebugManager: mockDebugManager,
    });

    const normalizeBtn = container.querySelector('[aria-label="Cycle normalize mode"]') as HTMLElement;
    expect(normalizeBtn).toBeTruthy();
    await fireEvent.pointerDown(normalizeBtn);
    expect(mockDebugManager.cycleNormalizeMode).toHaveBeenCalledOnce();
  });

  it('normalize button shows active state and badge when mode is soft', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ normalizeMode: 'soft' as const }),
      getUniforms: mockGetUniforms,
    });

    const normalizeBtn = container.querySelector('[aria-label="Cycle normalize mode"]') as HTMLElement;
    expect(normalizeBtn.classList.contains('active')).toBe(true);
    const badge = normalizeBtn.querySelector('.normalize-badge');
    expect(badge?.textContent).toBe('S');
  });

  it('normalize button shows active state and badge when mode is abs', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ normalizeMode: 'abs' as const }),
      getUniforms: mockGetUniforms,
    });

    const normalizeBtn = container.querySelector('[aria-label="Cycle normalize mode"]') as HTMLElement;
    expect(normalizeBtn.classList.contains('active')).toBe(true);
    const badge = normalizeBtn.querySelector('.normalize-badge');
    expect(badge?.textContent).toBe('A');
  });

  it('shows step button when inline rendering is on', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isInlineRenderingEnabled: true }),
      getUniforms: mockGetUniforms,
    });

    const stepBtn = container.querySelector('[aria-label="Toggle step threshold"]');
    expect(stepBtn).toBeTruthy();
  });

  it('shows step button even when inline rendering is off', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isInlineRenderingEnabled: false }),
      getUniforms: mockGetUniforms,
    });

    const stepBtn = container.querySelector('[aria-label="Toggle step threshold"]');
    expect(stepBtn).toBeTruthy();
  });

  it('step button calls toggleStep on manager', async () => {
    const mockDebugManager = createMockShaderDebugManager();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
      shaderDebugManager: mockDebugManager,
    });

    const stepBtn = container.querySelector('[aria-label="Toggle step threshold"]') as HTMLElement;
    expect(stepBtn).toBeTruthy();
    await fireEvent.pointerDown(stepBtn);
    expect(mockDebugManager.toggleStep).toHaveBeenCalledOnce();
  });

  it('step button shows active state when step is enabled', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isStepEnabled: true }),
      getUniforms: mockGetUniforms,
    });

    const stepBtn = container.querySelector('[aria-label="Toggle step threshold"]') as HTMLElement;
    expect(stepBtn.classList.contains('active')).toBe(true);
  });

  it('step button shows inactive state when step is disabled', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isStepEnabled: false }),
      getUniforms: mockGetUniforms,
    });

    const stepBtn = container.querySelector('[aria-label="Toggle step threshold"]') as HTMLElement;
    expect(stepBtn.classList.contains('active')).toBe(false);
  });

  it('shows step edge input when step is enabled', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isStepEnabled: true, stepEdge: 0.5 }),
      getUniforms: mockGetUniforms,
    });

    const stepInput = container.querySelector('[aria-label="Step edge threshold"]') as HTMLInputElement;
    expect(stepInput).toBeTruthy();
    expect(stepInput.type).toBe('number');
  });

  it('hides step edge input when step is disabled', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isStepEnabled: false }),
      getUniforms: mockGetUniforms,
    });

    const stepInput = container.querySelector('[aria-label="Step edge threshold"]');
    expect(stepInput).toBeFalsy();
  });

  it('step edge input calls setStepEdge on manager', async () => {
    const mockDebugManager = createMockShaderDebugManager();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isStepEnabled: true, stepEdge: 0.5 }),
      getUniforms: mockGetUniforms,
      shaderDebugManager: mockDebugManager,
    });

    const stepInput = container.querySelector('[aria-label="Step edge threshold"]') as HTMLInputElement;
    await fireEvent.input(stepInput, { target: { value: '0.75' } });
    expect(mockDebugManager.setStepEdge).toHaveBeenCalledWith(0.75);
  });

  it('line number tooltip shows fallback text when no lineContent', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ lineContent: null }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info');
    expect(lineInfo).toBeTruthy();
    expect(lineInfo?.getAttribute('data-tooltip')).toBe('Line 6');
  });

  it('line number tooltip does not include line number prefix', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ lineContent: '  vec3 col = vec3(0.0);' }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info');
    const tooltip = lineInfo?.getAttribute('data-tooltip');
    expect(tooltip).toBe('vec3 col = vec3(0.0);');
    expect(tooltip).not.toMatch(/^L\d/);
  });

  it('error tooltip takes priority over line content', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({
        lineContent: 'float d = length(p) - r;',
        debugError: 'No debuggable variable on this line',
      }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info');
    expect(lineInfo?.getAttribute('data-tooltip')).toBe('No debuggable variable on this line');
    expect(lineInfo?.classList.contains('error')).toBe(true);
  });

  it('line number has error class when debugError is set', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ debugError: 'Some error' }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info');
    expect(lineInfo?.classList.contains('error')).toBe(true);
  });

  it('line number has no error class when debugError is null', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ debugError: null }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info');
    expect(lineInfo?.classList.contains('error')).toBe(false);
  });

  it('does not show the line error tooltip when hovered directly without first hovering the line badge', async () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ debugError: 'Some error' }),
      getUniforms: mockGetUniforms,
    });

    const tooltip = container.querySelector('.line-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(false);

    await fireEvent.mouseEnter(tooltip);
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('keeps the line error tooltip visible when moving from the line badge onto the tooltip', async () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ debugError: 'Some error' }),
      getUniforms: mockGetUniforms,
    });

    const lineInfo = container.querySelector('.header-info') as HTMLElement;
    const tooltip = container.querySelector('.line-tooltip') as HTMLElement;

    await fireEvent.mouseEnter(lineInfo);
    expect(tooltip.classList.contains('visible')).toBe(true);

    await fireEvent.mouseEnter(tooltip);
    await fireEvent.mouseLeave(lineInfo);
    expect(tooltip.classList.contains('visible')).toBe(true);

    await fireEvent.mouseLeave(tooltip);
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('loop rows show Iterations label', () => {
    const ctx = makeFunctionContext({
      loops: [
        {
          loopIndex: 0,
          lineNumber: 10,
          endLine: 15,
          loopHeader: 'for (int i = 0; i < 10; i++)',
          maxIter: null,
        },
      ],
    });

    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: ctx }),
      getUniforms: mockGetUniforms,
    });

    const iterLabels = container.querySelectorAll('.loop-iter-label');
    expect(iterLabels.length).toBe(1);
    expect(iterLabels[0].textContent).toBe('Iterations');
  });

  it('uniforms section has no border when no loops or params above', () => {
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: null }),
      getUniforms: mockGetUniforms,
    });

    const uniformsSection = container.querySelector('.uniforms-section');
    expect(uniformsSection).toBeTruthy();
    expect(uniformsSection?.classList.contains('has-border')).toBe(false);
  });

  it('uniforms section has border when loops are above', () => {
    const ctx = makeFunctionContext({
      loops: [
        {
          loopIndex: 0,
          lineNumber: 10,
          endLine: 15,
          loopHeader: 'for (int i = 0; i < 10; i++)',
          maxIter: null,
        },
      ],
    });

    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: ctx }),
      getUniforms: mockGetUniforms,
    });

    const uniformsSection = container.querySelector('.uniforms-section');
    expect(uniformsSection?.classList.contains('has-border')).toBe(true);
  });

  it('uniforms section has border when params are above', () => {
    const ctx = makeFunctionContext();

    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ functionContext: ctx }),
      getUniforms: mockGetUniforms,
    });

    const uniformsSection = container.querySelector('.uniforms-section');
    expect(uniformsSection?.classList.contains('has-border')).toBe(true);
  });

  // ----------------------------------------------------------------
  // Variable Inspector section
  // ----------------------------------------------------------------
  describe('Variable Inspector', () => {
    it('shows variable inspector button in header', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState(),
        getUniforms: mockGetUniforms,
      });

      const varBtn = container.querySelector('[aria-label="Toggle variable inspector"]');
      expect(varBtn).toBeTruthy();
    });

    it('variable inspector button calls toggleVariableInspector on manager', async () => {
      const mockDebugManager = createMockShaderDebugManager();
      const { container } = render(DebugPanel, {
        debugState: makeDebugState(),
        getUniforms: mockGetUniforms,
        shaderDebugManager: mockDebugManager,
      });

      const varBtn = container.querySelector('[aria-label="Toggle variable inspector"]') as HTMLElement;
      await fireEvent.pointerDown(varBtn);
      expect(mockDebugManager.toggleVariableInspector).toHaveBeenCalledOnce();
    });

    it('variable inspector button shows active state when enabled', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
      });

      const varBtn = container.querySelector('[aria-label="Toggle variable inspector"]') as HTMLElement;
      expect(varBtn.classList.contains('active')).toBe(true);
    });

    it('variable inspector button shows inactive state when disabled', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: false }),
        getUniforms: mockGetUniforms,
      });

      const varBtn = container.querySelector('[aria-label="Toggle variable inspector"]') as HTMLElement;
      expect(varBtn.classList.contains('active')).toBe(false);
    });

    it('shows hint text when variable inspector is off', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: false }),
        getUniforms: mockGetUniforms,
      });

      expect(container.querySelector('.var-hint-section')).toBeTruthy();
      expect(container.querySelector('.hint-text')?.textContent).toContain('Enable Variable Inspector');
    });

    it('shows VariablesSection when variable inspector is on', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
      });

      expect(container.querySelector('.variables-section')).toBeTruthy();
      expect(container.querySelector('.var-hint-section')).toBeFalsy();
    });

    it('hides VariablesSection when variable inspector is off', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: false }),
        getUniforms: mockGetUniforms,
      });

      expect(container.querySelector('.variables-section')).toBeFalsy();
    });

    it('uniforms has-border when variable inspector is on', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true, functionContext: null }),
        getUniforms: mockGetUniforms,
      });

      const uniformsSection = container.querySelector('.uniforms-section');
      expect(uniformsSection?.classList.contains('has-border')).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // Prop passthrough to VariablesSection
  // ----------------------------------------------------------------
  describe('VariablesSection prop passthrough', () => {
    function getCtrlButton(container: HTMLElement, text: string): HTMLElement | undefined {
      return Array.from(container.querySelectorAll('.ctrl-btn')).find(
        b => b.textContent?.trim() === text,
      ) as HTMLElement | undefined;
    }

    it('passes refreshMode through to VariablesSection', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'manual' as RefreshMode,
      });

      expect(getCtrlButton(container, 'manual')).toHaveClass('active');
    });

    it('passes refreshMode=polling through to VariablesSection', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'polling' as RefreshMode,
      });

      const pollingBtn = container.querySelector('.ctrl-btn.has-input');
      expect(pollingBtn).toHaveClass('active');
      expect(getCtrlButton(container, 'manual')).not.toHaveClass('active');
    });

    it('passes refreshMode=realtime through to VariablesSection', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'realtime' as RefreshMode,
      });

      expect(getCtrlButton(container, 'realtime')).toHaveClass('active');
      expect(getCtrlButton(container, 'manual')).not.toHaveClass('active');
    });

    it('passes refreshMode=pause through to VariablesSection', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'pause' as RefreshMode,
      });

      expect(getCtrlButton(container, 'pause')).toHaveClass('active');
    });

    it('refreshMode active border updates on rerender', async () => {
      const { container, rerender } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ isVariableInspectorEnabled: true }),
          getUniforms: mockGetUniforms,
          refreshMode: 'polling' as RefreshMode,
        },
      });

      const pollingBtn = container.querySelector('.ctrl-btn.has-input');
      expect(pollingBtn).toHaveClass('active');
      expect(getCtrlButton(container, 'manual')).not.toHaveClass('active');

      await rerender({
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'manual' as RefreshMode,
      });

      expect(getCtrlButton(container, 'manual')).toHaveClass('active');
      expect(container.querySelector('.ctrl-btn.has-input')).not.toHaveClass('active');
    });

    it('refreshMode border updates while debugState also changes', async () => {
      const { container, rerender } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ isVariableInspectorEnabled: true, capturedVariables: [] }),
          getUniforms: mockGetUniforms,
          refreshMode: 'polling' as RefreshMode,
        },
      });

      expect(container.querySelector('.ctrl-btn.has-input')).toHaveClass('active');

      // Simulate: refreshMode changes AND capturedVariables change simultaneously
      await rerender({
        debugState: makeDebugState({
          isVariableInspectorEnabled: true,
          capturedVariables: [{
            varName: 'x', varType: 'float', value: null,
            channelMeans: [0.5], channelStats: [{ min: 0, max: 1, mean: 0.5 }],
            stats: { min: 0, max: 1, mean: 0.5 }, histogram: null,
            channelHistograms: null, colorFrequencies: null, thumbnail: null,
            declarationLine: 0, gridWidth: 32, gridHeight: 32,
          }],
        }),
        getUniforms: mockGetUniforms,
        refreshMode: 'realtime' as RefreshMode,
      });

      expect(getCtrlButton(container, 'realtime')).toHaveClass('active');
      expect(container.querySelector('.ctrl-btn.has-input')).not.toHaveClass('active');
    });

    it('passes sampleSize through to VariablesSection', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        sampleSize: 64,
      });

      expect(getCtrlButton(container, '64')).toHaveClass('active');
      expect(getCtrlButton(container, '32')).not.toHaveClass('active');
    });

    it('sampleSize active border updates on rerender', async () => {
      const { container, rerender } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ isVariableInspectorEnabled: true }),
          getUniforms: mockGetUniforms,
          sampleSize: 32,
          hasPixelSelected: false,
        },
      });

      expect(getCtrlButton(container, '32')).toHaveClass('active');

      await rerender({
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        sampleSize: 128,
        hasPixelSelected: false,
      });

      expect(getCtrlButton(container, '128')).toHaveClass('active');
      expect(getCtrlButton(container, '32')).not.toHaveClass('active');
    });

    it('hides sample size buttons when hasPixelSelected is true', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        hasPixelSelected: true,
      });

      expect(getCtrlButton(container, '16')).toBeUndefined();
      expect(getCtrlButton(container, '32')).toBeUndefined();
    });

    it('shows sample size buttons when hasPixelSelected is false', () => {
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        hasPixelSelected: false,
      });

      expect(getCtrlButton(container, '32')).toBeInTheDocument();
    });

    it('onChangeRefreshMode callback propagates from VariablesSection', async () => {
      const mockVarCapture = createMockVariableCaptureManager();
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'polling' as RefreshMode,
        variableCaptureManager: mockVarCapture,
      });

      await fireEvent.click(getCtrlButton(container, 'manual')!);
      expect(mockVarCapture.changeRefreshMode).toHaveBeenCalledWith('manual', false);
    });

    it('onChangeSampleSize callback propagates from VariablesSection', async () => {
      const mockVarCapture = createMockVariableCaptureManager();
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        variableCaptureManager: mockVarCapture,
        hasPixelSelected: false,
      });

      await fireEvent.click(getCtrlButton(container, '128')!);
      expect(mockVarCapture.changeSampleSize).toHaveBeenCalledWith(128);
    });

    it('onChangePollingMs callback propagates from VariablesSection', async () => {
      const mockVarCapture = createMockVariableCaptureManager();
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({ isVariableInspectorEnabled: true }),
        getUniforms: mockGetUniforms,
        refreshMode: 'polling' as RefreshMode,
        pollingMs: 500,
        variableCaptureManager: mockVarCapture,
      });

      const msInput = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(msInput, { target: { value: '1000' } });
      expect(mockVarCapture.changePollingMs).toHaveBeenCalledWith(1000, false);
    });

    it('onExpandVarHistogram callback propagates from VariablesSection', async () => {
      const onExpandVarHistogram = vi.fn();
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({
          isVariableInspectorEnabled: true,
          capturedVariables: [{
            varName: 'x', varType: 'float', value: null,
            channelMeans: [0.5], channelStats: [{ min: 0, max: 1, mean: 0.5 }],
            stats: { min: 0, max: 1, mean: 0.5 }, histogram: null,
            channelHistograms: null, colorFrequencies: null, thumbnail: null,
            declarationLine: 0, gridWidth: 32, gridHeight: 32,
          }],
        }),
        getUniforms: mockGetUniforms,
        onExpandVarHistogram,
      });

      // VariableRow renders an expand button for grid mode scalars
      const expandBtn = container.querySelector('.expand-btn') as HTMLElement;
      if (expandBtn) {
        await fireEvent.click(expandBtn);
        expect(onExpandVarHistogram).toHaveBeenCalledWith('x');
      }
    });

    it('onVarClick callback propagates when line badge is clicked', async () => {
      const onVarClick = vi.fn();
      const { container } = render(DebugPanel, {
        debugState: makeDebugState({
          isVariableInspectorEnabled: true,
          capturedVariables: [{
            varName: 'myVar', varType: 'float', value: null,
            channelMeans: [0.5], channelStats: [{ min: 0, max: 1, mean: 0.5 }],
            stats: { min: 0, max: 1, mean: 0.5 }, histogram: null,
            channelHistograms: null, colorFrequencies: null, thumbnail: null,
            declarationLine: 12, gridWidth: 32, gridHeight: 32,
          }],
        }),
        getUniforms: mockGetUniforms,
        onVarClick,
      });

      const lineEl = container.querySelector('.var-line') as HTMLElement;
      expect(lineEl).toBeInTheDocument();
      expect(lineEl.textContent).toBe('L13');
      await fireEvent.click(lineEl);
      expect(onVarClick).toHaveBeenCalledWith('myVar', 12);
    });

    it('refreshMode border survives rapid debugState changes', async () => {
      const { container, rerender } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ isVariableInspectorEnabled: true, capturedVariables: [] }),
          getUniforms: mockGetUniforms,
          refreshMode: 'manual' as RefreshMode,
        },
      });

      expect(getCtrlButton(container, 'manual')).toHaveClass('active');

      // Simulate multiple rapid debugState updates (capturedVariables changing)
      // while refreshMode stays the same
      for (let i = 0; i < 5; i++) {
        await rerender({
          debugState: makeDebugState({
            isVariableInspectorEnabled: true,
            capturedVariables: [{
              varName: 'x', varType: 'float', value: null,
              channelMeans: [0.1 * i], channelStats: [{ min: 0, max: 1, mean: 0.1 * i }],
              stats: { min: 0, max: 1, mean: 0.1 * i }, histogram: null,
              channelHistograms: null, colorFrequencies: null, thumbnail: null,
              declarationLine: 0, gridWidth: 32, gridHeight: 32,
            }],
          }),
          getUniforms: mockGetUniforms,
          refreshMode: 'manual' as RefreshMode,
        });
      }

      // Active border should persist through all the debugState churn
      expect(getCtrlButton(container, 'manual')).toHaveClass('active');
      expect(container.querySelector('.ctrl-btn.has-input')).not.toHaveClass('active');
    });
  });
});
