import { render, fireEvent, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import DebugPanel from '../../../lib/components/debug/DebugPanel.svelte';
import type { ShaderDebugState, DebugFunctionContext } from '../../../lib/types/ShaderDebugState';
import type { PassUniforms } from '../../../../../rendering/src/models/PassUniforms';

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
};

function mockGetUniforms(): PassUniforms | null {
  return mockUniforms;
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
    const onToggleLineLock = vi.fn();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isLineLocked: false }),
      getUniforms: mockGetUniforms,
      onToggleLineLock,
    });

    const lockBtn = container.querySelector('[aria-label="Toggle line lock"]') as HTMLElement;
    expect(lockBtn).toBeTruthy();
    expect(lockBtn.classList.contains('active')).toBe(false);

    await fireEvent.click(lockBtn);
    expect(onToggleLineLock).toHaveBeenCalledOnce();
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

    await fireEvent.click(inlineBtn);
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

    await fireEvent.click(inspectorBtn);
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

  it('normalize button calls onCycleNormalize', async () => {
    const onCycleNormalize = vi.fn();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
      onCycleNormalize,
    });

    const normalizeBtn = container.querySelector('[aria-label="Cycle normalize mode"]') as HTMLElement;
    expect(normalizeBtn).toBeTruthy();
    await fireEvent.click(normalizeBtn);
    expect(onCycleNormalize).toHaveBeenCalledOnce();
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

  it('step button calls onToggleStep', async () => {
    const onToggleStep = vi.fn();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState(),
      getUniforms: mockGetUniforms,
      onToggleStep,
    });

    const stepBtn = container.querySelector('[aria-label="Toggle step threshold"]') as HTMLElement;
    expect(stepBtn).toBeTruthy();
    await fireEvent.click(stepBtn);
    expect(onToggleStep).toHaveBeenCalledOnce();
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

  it('step edge input calls onSetStepEdge', async () => {
    const onSetStepEdge = vi.fn();
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isStepEnabled: true, stepEdge: 0.5 }),
      getUniforms: mockGetUniforms,
      onSetStepEdge,
    });

    const stepInput = container.querySelector('[aria-label="Step edge threshold"]') as HTMLInputElement;
    await fireEvent.input(stepInput, { target: { value: '0.75' } });
    expect(onSetStepEdge).toHaveBeenCalledWith(0.75);
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
});
