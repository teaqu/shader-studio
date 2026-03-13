import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import VariablesSection from '../../lib/components/debug/VariablesSection.svelte';
import type { RefreshMode, CapturedVariable } from '../../lib/VariableCaptureManager';

const BASE_PROPS = {
  capturedVariables: [] as CapturedVariable[],
  isPixelMode: false,
  isLoading: false,
  onExpandToggle: () => {},
  sampleSize: 32,
  onChangeSampleSize: () => {},
  refreshMode: 'polling' as RefreshMode,
  pollingMs: 500,
  onChangeRefreshMode: () => {},
  onChangePollingMs: () => {},
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
  };
}

function getButtonByText(container: HTMLElement, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll('.ctrl-btn')).find(
    b => b.textContent?.trim() === text,
  ) as HTMLElement | undefined;
}

describe('VariablesSection', () => {
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

    it('calls onChangeSampleSize when size button clicked', async () => {
      const onChangeSampleSize = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, onChangeSampleSize },
      });

      await fireEvent.click(getButtonByText(container, '64')!);
      expect(onChangeSampleSize).toHaveBeenCalledWith(64);
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
      const onChangeSampleSize = vi.fn();
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, sampleSize: 32, onChangeSampleSize },
      });

      expect(getButtonByText(container, '32')).toHaveClass('active');

      // User clicks 64
      await fireEvent.click(getButtonByText(container, '64')!);
      expect(onChangeSampleSize).toHaveBeenCalledWith(64);

      // Parent updates sampleSize prop in response
      await rerender({ ...BASE_PROPS, sampleSize: 64, onChangeSampleSize });

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

    it('calls onChangeRefreshMode when manual clicked', async () => {
      const onChangeRefreshMode = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode, onChangeRefreshMode },
      });

      await fireEvent.click(getButtonByText(container, 'manual')!);
      expect(onChangeRefreshMode).toHaveBeenCalledWith('manual');
    });

    it('toggles manual OFF to polling', async () => {
      const onChangeRefreshMode = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, onChangeRefreshMode },
      });

      await fireEvent.click(getButtonByText(container, 'manual')!);
      expect(onChangeRefreshMode).toHaveBeenCalledWith('polling');
    });

    it('toggles realtime OFF to polling', async () => {
      const onChangeRefreshMode = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'realtime' as RefreshMode, onChangeRefreshMode },
      });

      await fireEvent.click(getButtonByText(container, 'realtime')!);
      expect(onChangeRefreshMode).toHaveBeenCalledWith('polling');
    });

    it('toggles pause OFF to polling', async () => {
      const onChangeRefreshMode = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'pause' as RefreshMode, onChangeRefreshMode },
      });

      await fireEvent.click(getButtonByText(container, 'pause')!);
      expect(onChangeRefreshMode).toHaveBeenCalledWith('polling');
    });

    it('calls onChangePollingMs when ms input changed', async () => {
      const onChangePollingMs = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode, pollingMs: 500, onChangePollingMs },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '2000' } });
      expect(onChangePollingMs).toHaveBeenCalledWith(2000);
    });

    it('click + rerender simulates refresh mode round-trip', async () => {
      const onChangeRefreshMode = vi.fn();
      const { container, rerender } = render(VariablesSection, {
        props: { ...BASE_PROPS, refreshMode: 'polling' as RefreshMode, onChangeRefreshMode },
      });

      const pollingBtn = container.querySelector('.ctrl-btn.has-input');
      expect(pollingBtn).toHaveClass('active');

      // User clicks manual
      await fireEvent.click(getButtonByText(container, 'manual')!);
      expect(onChangeRefreshMode).toHaveBeenCalledWith('manual');

      // Parent updates refreshMode prop in response
      await rerender({ ...BASE_PROPS, refreshMode: 'manual' as RefreshMode, onChangeRefreshMode });

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
  // onVarClick passthrough
  // ----------------------------------------------------------------
  describe('onVarClick passthrough', () => {
    it('calls onVarClick with varName and declarationLine when variable name clicked', async () => {
      const onVarClick = vi.fn();
      const vars = [makeGridVar('myFloat', 'float', 0.5, 7)];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars, onVarClick },
      });

      const nameEl = container.querySelector('.var-name.clickable') as HTMLElement;
      expect(nameEl).toBeTruthy();
      await fireEvent.click(nameEl);
      expect(onVarClick).toHaveBeenCalledWith('myFloat', 7);
    });

    it('calls onVarClick with correct args for each variable', async () => {
      const onVarClick = vi.fn();
      const vars = [
        makeGridVar('a', 'float', 0.1, 3),
        makeGridVar('b', 'float', 0.2, 12),
      ];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars, onVarClick },
      });

      const names = container.querySelectorAll('.var-name.clickable');
      expect(names.length).toBe(2);
      await fireEvent.click(names[1] as HTMLElement);
      expect(onVarClick).toHaveBeenCalledWith('b', 12);
    });

    it('does not call onVarClick when expand button is clicked', async () => {
      const onVarClick = vi.fn();
      const onExpandToggle = vi.fn();
      const vars = [makeGridVar('x', 'float', 0.5, 5)];

      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, capturedVariables: vars, onVarClick, onExpandToggle },
      });

      const expandBtn = container.querySelector('.expand-btn') as HTMLElement;
      if (expandBtn) {
        await fireEvent.click(expandBtn);
        expect(onVarClick).not.toHaveBeenCalled();
      }
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
      const onChangePollingMs = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, pollingMs: 500, onChangePollingMs },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: '0' } });
      expect(onChangePollingMs).not.toHaveBeenCalled();

      await fireEvent.input(input, { target: { value: '-100' } });
      expect(onChangePollingMs).not.toHaveBeenCalled();
    });

    it('pollingMs input ignores NaN values', async () => {
      const onChangePollingMs = vi.fn();
      const { container } = render(VariablesSection, {
        props: { ...BASE_PROPS, pollingMs: 500, onChangePollingMs },
      });

      const input = container.querySelector('.ms-input') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: 'abc' } });
      expect(onChangePollingMs).not.toHaveBeenCalled();
    });
  });
});
