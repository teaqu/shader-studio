// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import VariablesSection from '../../lib/components/debug/VariablesSection.svelte';
import type { RefreshMode, CapturedVariable, VariableCaptureManager } from '../../lib/VariableCaptureManager';
import { getVariablePreview, resetVariablePreview } from '../../lib/state/variablePreviewState.svelte';

function createMockVariableCaptureManager(overrides: Partial<VariableCaptureManager> = {}) {
  return {
    changeSampleSize: vi.fn(),
    changeRefreshMode: vi.fn(),
    changePollingMs: vi.fn(),
    sampleSize: 32,
    getActiveRefreshMode: vi.fn().mockReturnValue('polling'),
    getActivePollingMs: vi.fn().mockReturnValue(500),
    ...overrides,
  } as unknown as VariableCaptureManager;
}

const BASE_PROPS = {
  capturedVariables: [] as CapturedVariable[],
  isPixelMode: false,
  isLoading: false,
  captureError: null as string | null,
  onExpandToggle: () => {},
  variableCaptureManager: createMockVariableCaptureManager(),
  sampleSize: 32,
  refreshMode: 'polling' as RefreshMode,
  pollingMs: 500,
  hasPixelSelected: false,
};

function makeGridVar(name: string, type: string, mean: number, declarationLine = 0): CapturedVariable {
  return {
    varName: name,
    varType: type,
    value: null,
    channelMeans: [mean],
    channelStats: [{ min: 0, max: 1, mean }],
    stats: type === 'float' ? { min: 0, max: 1, mean } : null,
    histogram: null,
    channelHistograms: null,
    colorFrequencies: null,
    thumbnail: null,
    gridWidth: 32,
    gridHeight: 32,
    declarationLine,
    captureLine: 5,
    captureFilePath: '/test.glsl',
    captureBufferName: 'Image',
  };
}

function makeGridVarWithThumbnail(name: string, type: string, mean: number, declarationLine = 0): CapturedVariable {
  return {
    ...makeGridVar(name, type, mean, declarationLine),
    thumbnail: new Uint8ClampedArray(32 * 32 * 4).fill(128),
  };
}

function makePixelVar(name: string, type: string, value: number[], declarationLine = 0): CapturedVariable {
  return {
    varName: name,
    varType: type,
    value,
    channelMeans: null,
    channelStats: null,
    stats: null,
    histogram: null,
    channelHistograms: null,
    colorFrequencies: null,
    thumbnail: null,
    gridWidth: 1,
    gridHeight: 1,
    declarationLine,
    captureLine: 5,
    captureFilePath: '/test.glsl',
    captureBufferName: 'Image',
  };
}

function getButtonByText(container: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll('.ctrl-btn')).find(
    b => b.textContent?.trim() === text,
  ) as HTMLElement | undefined;
}

describe('VariablesSection', () => {
  beforeEach(() => {
    resetVariablePreview();
  });

  it('shows capture errors instead of the loading state when capture fails', () => {
    const { getByText, queryByText } = render(VariablesSection, {
      props: { ...BASE_PROPS, isLoading: true, captureError: 'Failed to capture variables' },
    });

    expect(getByText('Failed to capture variables')).toBeInTheDocument();
    expect(queryByText('Capturing...')).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // Sample size buttons
  // ----------------------------------------------------------------
  describe('Sample size buttons', () => {
    it('shows size buttons when hasPixelSelected is false', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, hasPixelSelected: false },
      });

      for (const s of ['16', '32', '64', '128']) {
        expect(getButtonByText(container, s)).toBeInTheDocument();
      }
    });

    it('hides size buttons when hasPixelSelected is true', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, hasPixelSelected: true },
      });

      for (const s of ['16', '32', '64', '128']) {
        expect(getButtonByText(container, s)).toBeUndefined();
      }
    });

    it('shows active border on current sample size', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, sampleSize: 32 },
      });

      expect(getButtonByText(container, '32')).toHaveClass('active');
      expect(getButtonByText(container, '64')).not.toHaveClass('active');
    });

    it('updates active border when sampleSize prop changes', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, sampleSize: 32 },
      });

      expect(getButtonByText(container, '32')).toHaveClass('active');
      expect(getButtonByText(container, '64')).not.toHaveClass('active');

      await rerender({ ...BASE_PROPS, sampleSize: 64 });

      expect(getButtonByText(container, '32')).not.toHaveClass('active');
      expect(getButtonByText(container, '64')).toHaveClass('active');
    });

    it('calls changeSampleSize on manager when size button clicked', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, variableCaptureManager: mockManager },
      });

      await fireEvent.click(getButtonByText(container, '64')!);
      expect(mockManager.changeSampleSize).toHaveBeenCalledWith(64);
    });

    it('active border follows prop through multiple changes', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, sampleSize: 16 },
      });

      expect(getButtonByText(container, '16')).toHaveClass('active');

      await rerender({ ...BASE_PROPS, sampleSize: 128 });
      expect(getButtonByText(container, '16')).not.toHaveClass('active');
      expect(getButtonByText(container, '128')).toHaveClass('active');

      await rerender({ ...BASE_PROPS, sampleSize: 32 });
      expect(getButtonByText(container, '128')).not.toHaveClass('active');
      expect(getButtonByText(container, '32')).toHaveClass('active');
    });

    it('click + rerender simulates full parent round-trip', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, sampleSize: 32, variableCaptureManager: mockManager },
      });

      expect(getButtonByText(container, '32')).toHaveClass('active');

      // User clicks 64
      await fireEvent.click(getButtonByText(container, '64')!);
      expect(mockManager.changeSampleSize).toHaveBeenCalledWith(64);

      // Parent updates sampleSize prop in response
      await rerender({ ...BASE_PROPS, sampleSize: 64, variableCaptureManager: mockManager });

      expect(getButtonByText(container, '32')).not.toHaveClass('active');
      expect(getButtonByText(container, '64')).toHaveClass('active');
    });
  });

  // ----------------------------------------------------------------
  // Refresh mode buttons
  // ----------------------------------------------------------------
  describe('Refresh mode buttons', () => {
    it('shows active border on current refresh mode (polling)', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode },
      });

      const pollingBtn = container.querySelector('.ctrl-btn.has-input');
      expect(pollingBtn).toHaveClass('active');
      expect(getButtonByText(container, 'manual')).not.toHaveClass('active');
    });

    it('shows active border on manual mode', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode },
      });

      expect(getButtonByText(container, 'manual')).toHaveClass('active');

      const pollingBtn = container.querySelector('.ctrl-btn.has-input');
      expect(pollingBtn).not.toHaveClass('active');
    });

    it('updates active border when refreshMode prop changes', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode },
      });

      expect(getButtonByText(container, 'manual')).toHaveClass('active');
      expect(getButtonByText(container, 'realtime')).not.toHaveClass('active');

      await rerender({ ...BASE_PROPS, refreshMode: 'realtime' as RefreshMode });

      expect(getButtonByText(container, 'manual')).not.toHaveClass('active');
      expect(getButtonByText(container, 'realtime')).toHaveClass('active');
    });

    it('calls changeRefreshMode on manager when manual clicked', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode, variableCaptureManager: mockManager },
      });

      await fireEvent.click(getButtonByText(container, 'manual')!);
      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('manual', false);
    });

    it('toggles manual OFF to polling', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, variableCaptureManager: mockManager },
      });

      await fireEvent.click(getButtonByText(container, 'manual')!);
      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('polling', false);
    });

    it('toggles realtime OFF to polling', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'realtime' as RefreshMode, variableCaptureManager: mockManager },
      });

      await fireEvent.click(getButtonByText(container, 'realtime')!);
      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('polling', false);
    });

    it('toggles pause OFF to polling', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'pause' as RefreshMode, variableCaptureManager: mockManager },
      });

      await fireEvent.click(getButtonByText(container, 'pause')!);
      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('polling', false);
    });

    it('calls changePollingMs on manager when ms input changed', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode, pollingMs: 500, variableCaptureManager: mockManager },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '2000' } });
      expect(mockManager.changeRefreshMode).not.toHaveBeenCalled();
      expect(mockManager.changePollingMs).toHaveBeenCalledWith(2000, false);
    });

    it('switches to polling when ms input changed from another refresh mode', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, pollingMs: 500, variableCaptureManager: mockManager },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '750' } });

      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('polling', false);
      expect(mockManager.changePollingMs).toHaveBeenCalledWith(750, false);
    });

    it('switches to polling when ms input is focused from another refresh mode', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, pollingMs: 500, variableCaptureManager: mockManager },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.focus(input);

      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('polling', false);
      expect(mockManager.changePollingMs).not.toHaveBeenCalled();
    });

    it('click + rerender simulates refresh mode round-trip', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode, variableCaptureManager: mockManager },
      });

      const pollingBtn = container.querySelector('.ctrl-btn.has-input');
      expect(pollingBtn).toHaveClass('active');

      // User clicks manual
      await fireEvent.click(getButtonByText(container, 'manual')!);
      expect(mockManager.changeRefreshMode).toHaveBeenCalledWith('manual', false);

      // Parent updates refreshMode prop in response
      await rerender({ ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, variableCaptureManager: mockManager });

      expect(getButtonByText(container, 'manual')).toHaveClass('active');
      expect(container.querySelector('.ctrl-btn.has-input')).not.toHaveClass('active');
    });
  });

  // ----------------------------------------------------------------
  // Loading & empty states
  // ----------------------------------------------------------------
  describe('Loading & empty states', () => {
    it('shows "Capturing..." when loading and no variables', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, isLoading: true, capturedVariables: [] },
      });

      expect(container.querySelector('.loading-text')?.textContent).toBe('Capturing...');
      expect(container.querySelector('.empty-text')).toBeFalsy();
    });

    it('shows "No variables in scope" when not loading and no variables', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, isLoading: false, capturedVariables: [] },
      });

      expect(container.querySelector('.empty-text')?.textContent).toBe('No variables in scope');
      expect(container.querySelector('.loading-text')).toBeFalsy();
    });

    it('does not show loading/empty when variables exist even if isLoading=true', () => {
      const { container } = render(VariablesSection, {
        props: {
          ...BASE_PROPS,
          isLoading: true,
          capturedVariables: [makeGridVar('x', 'float', 0.5)],
        },
      });

      expect(container.querySelector('.loading-text')).toBeFalsy();
      expect(container.querySelector('.empty-text')).toBeFalsy();
    });
  });

  // ----------------------------------------------------------------
  // Variable row rendering
  // ----------------------------------------------------------------
  describe('Variable row rendering', () => {
    it('renders one VariableRow per captured variable', () => {
      const vars = [
        makeGridVar('x', 'float', 0.5),
        makeGridVar('y', 'float', 0.8),
        makeGridVar('z', 'float', 0.1),
      ];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars },
      });

      // VariableRow uses class .var-row
      const rows = container.querySelectorAll('.var-row');
      expect(rows.length).toBe(3);
    });

    it('displays variable names in rows', () => {
      const vars = [
        makeGridVar('myFloat', 'float', 0.5),
        makeGridVar('color', 'float', 0.3),
      ];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars },
      });

      const names = Array.from(container.querySelectorAll('.var-name')).map(el => el.textContent);
      expect(names).toContain('myFloat');
      expect(names).toContain('color');
    });

    it('displays variable types in rows', () => {
      const vars = [makeGridVar('x', 'float', 0.5)];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars },
      });

      const types = Array.from(container.querySelectorAll('.var-type')).map(el => el.textContent);
      expect(types).toContain('float');
    });

    it('calls onExpandToggle with variable name when expand clicked', async () => {
      const onExpandToggle = vi.fn();
      const vars = [makeGridVar('x', 'float', 0.5)];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars, onExpandToggle },
      });

      const expandBtn = container.querySelector('.expand-btn') as HTMLElement;
      if (expandBtn) {
        await fireEvent.click(expandBtn);
        expect(onExpandToggle).toHaveBeenCalledWith('x');
      }
    });

    it('renders pixel mode values when isPixelMode and value is set', () => {
      const vars = [makePixelVar('x', 'float', [0.75])];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, isPixelMode: true, capturedVariables: vars },
      });

      // Should contain the pixel value somewhere
      expect(container.textContent).toContain('0.75');
    });

    it('updates rows when capturedVariables change', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: [makeGridVar('x', 'float', 0.5)] },
      });

      expect(container.querySelectorAll('.var-row').length).toBe(1);

      await rerender({
        ...BASE_PROPS,
        capturedVariables: [
          makeGridVar('x', 'float', 0.5),
          makeGridVar('y', 'float', 0.3),
        ],
      });

      expect(container.querySelectorAll('.var-row').length).toBe(2);
    });

    it('removes rows when variables leave scope', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: {
          ...BASE_PROPS,
          capturedVariables: [
            makeGridVar('x', 'float', 0.5),
            makeGridVar('y', 'float', 0.3),
          ],
        },
      });

      expect(container.querySelectorAll('.var-row').length).toBe(2);

      await rerender({
        ...BASE_PROPS,
        capturedVariables: [],
      });

      expect(container.querySelectorAll('.var-row').length).toBe(0);
      expect(container.querySelector('.empty-text')).toBeTruthy();
    });
  });

  // ----------------------------------------------------------------
  // Line number display
  // ----------------------------------------------------------------
  describe('line number display', () => {
    it('shows line numbers for each variable', () => {
      const vars = [
        makeGridVar('a', 'float', 0.1, 2),
        makeGridVar('b', 'float', 0.2, 11),
      ];
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars },
      });
      const lineEls = container.querySelectorAll('.var-line');
      expect(lineEls.length).toBe(2);
      expect(lineEls[0].textContent).toBe('L3');
      expect(lineEls[1].textContent).toBe('L12');
    });

    it('calls onVarClick with varName and declarationLine when line number clicked', async () => {
      const onVarClick = vi.fn();
      const vars = [makeGridVar('myFloat', 'float', 0.5, 7)];
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars, onVarClick },
      });
      const lineEl = container.querySelector('.var-line') as HTMLElement;
      expect(lineEl).toBeTruthy();
      await fireEvent.click(lineEl);
      expect(onVarClick).toHaveBeenCalledWith('myFloat', 7);
    });

    it('updates shared preview state with variable identity when the mini preview is hovered', async () => {
      const vars = [makeGridVarWithThumbnail('myFloat', 'float', 0.5, 7)];
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars },
      });

      const preview = container.querySelector('.thumb-wrap') as HTMLElement;
      expect(preview).toBeTruthy();

      await fireEvent.mouseEnter(preview);
      expect(getVariablePreview()).toMatchObject({
        varName: 'myFloat',
        varType: 'float',
        debugLine: 5,
        activeBufferName: 'Image',
        filePath: '/test.glsl',
      });

      await fireEvent.mouseLeave(preview);
      expect(getVariablePreview()).toMatchObject({
        varName: null,
        varType: null,
        debugLine: null,
        activeBufferName: null,
        filePath: null,
      });
    });
  });

  // ----------------------------------------------------------------
  // Refresh mode border persists through variable updates
  // ----------------------------------------------------------------
  describe('Refresh mode stability under variable updates', () => {
    it('refreshMode active border persists when capturedVariables change', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, capturedVariables: [] },
      });

      expect(getButtonByText(container, 'manual')).toHaveClass('active');

      // capturedVariables update, refreshMode stays
      await rerender({
        ...BASE_PROPS,
        refreshMode: 'manual' as RefreshMode,
        capturedVariables: [makeGridVar('x', 'float', 0.5)],
      });

      expect(getButtonByText(container, 'manual')).toHaveClass('active');
      expect(container.querySelector('.ctrl-btn.has-input')).not.toHaveClass('active');
    });

    it('sampleSize active border persists when capturedVariables change', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, sampleSize: 64, capturedVariables: [] },
      });

      expect(getButtonByText(container, '64')).toHaveClass('active');

      await rerender({
        ...BASE_PROPS,
        sampleSize: 64,
        capturedVariables: [makeGridVar('x', 'float', 0.5)],
      });

      expect(getButtonByText(container, '64')).toHaveClass('active');
      expect(getButtonByText(container, '32')).not.toHaveClass('active');
    });

    it('refreshMode changes correctly while variables are present', async () => {
      const { container, rerender } = render(VariablesSection, {
        props: {
          ...BASE_PROPS,
          refreshMode: 'polling' as RefreshMode,
          capturedVariables: [makeGridVar('x', 'float', 0.5)],
        },
      });

      expect(container.querySelector('.ctrl-btn.has-input')).toHaveClass('active');

      await rerender({
        ...BASE_PROPS,
        refreshMode: 'realtime' as RefreshMode,
        capturedVariables: [makeGridVar('x', 'float', 0.5)],
      });

      expect(getButtonByText(container, 'realtime')).toHaveClass('active');
      expect(container.querySelector('.ctrl-btn.has-input')).not.toHaveClass('active');
    });

    it('pollingMs input reflects prop value', () => {
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, pollingMs: 2000 },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      expect(input.value).toBe('2000');
    });

    it('pollingMs input ignores non-positive values', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, pollingMs: 500, variableCaptureManager: mockManager },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '0' } });
      expect(mockManager.changePollingMs).not.toHaveBeenCalled();

      await fireEvent.input(input, { target: { value: '-100' } });
      expect(mockManager.changePollingMs).not.toHaveBeenCalled();
    });

    it('pollingMs input ignores NaN values', async () => {
      const mockManager = createMockVariableCaptureManager();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, pollingMs: 500, variableCaptureManager: mockManager },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: 'abc' } });
      expect(mockManager.changePollingMs).not.toHaveBeenCalled();
    });
  });
});
