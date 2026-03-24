import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import VariableRow from '../../lib/components/debug/VariableRow.svelte';
import type { CapturedVariable } from '../../lib/VariableCaptureManager';

const NULL_FIELDS = { thumbnail: null, channelHistograms: null, colorFrequencies: null, gridWidth: 32, gridHeight: 32, declarationLine: 0 } as const;

function makeFloatVar(value: number): CapturedVariable {
  return { varName: 'myFloat', varType: 'float', value: [value], channelMeans: null, channelStats: null, stats: null, histogram: null, ...NULL_FIELDS };
}

function makeVec3Var(x: number, y: number, z: number): CapturedVariable {
  return { varName: 'myVec3', varType: 'vec3', value: [x, y, z], channelMeans: null, channelStats: null, stats: null, histogram: null, ...NULL_FIELDS };
}

function makeGridScalarVar(): CapturedVariable {
  return {
    varName: 'gridVar', varType: 'float', value: null,
    channelMeans: [0.3],
    channelStats: [{ min: -0.5, max: 1.2, mean: 0.3 }],
    stats: { min: -0.5, max: 1.2, mean: 0.3 },
    histogram: null, ...NULL_FIELDS,
  };
}

// Varying vec — channels have different min/max so expand button appears
function makeGridVecVar(): CapturedVariable {
  return {
    varName: 'gridVec', varType: 'vec3', value: null,
    channelMeans: [0.21, 0.45, 0.80],
    channelStats: [
      { min: 0.0, max: 0.42, mean: 0.21 },
      { min: 0.1, max: 0.8, mean: 0.45 },
      { min: 0.6, max: 1.0, mean: 0.80 },
    ],
    stats: null, histogram: null, ...NULL_FIELDS,
  };
}

// Constant vec — all channels have min === max
function makeConstantVecVar(): CapturedVariable {
  return {
    varName: 'constVec', varType: 'vec2', value: null,
    channelMeans: [233223.0, 0.0],
    channelStats: [
      { min: 233223.0, max: 233223.0, mean: 233223.0 },
      { min: 0.0, max: 0.0, mean: 0.0 },
    ],
    stats: null, histogram: null, ...NULL_FIELDS,
  };
}

function makeExpandedVar(): CapturedVariable {
  return {
    varName: 'expandedVar', varType: 'float', value: null,
    channelMeans: [0.5],
    channelStats: [{ min: 0, max: 1, mean: 0.5 }],
    stats: { min: 0, max: 1, mean: 0.5 },
    histogram: { bins: [3, 5, 4, 2, 6], min: 0, max: 1 },
    ...NULL_FIELDS,
  };
}

function makeExpandedVecVar(): CapturedVariable {
  return {
    varName: 'expandedVec', varType: 'vec3', value: null,
    channelMeans: [0.5, 0.3, 0.8],
    channelStats: [
      { min: 0.0, max: 1.0, mean: 0.5 },
      { min: 0.0, max: 0.6, mean: 0.3 },
      { min: 0.5, max: 1.0, mean: 0.8 },
    ],
    stats: null, histogram: null,
    channelHistograms: [
      { bins: [1, 2, 3], min: 0, max: 1, label: 'x' },
      { bins: [3, 2, 1], min: 0, max: 0.6, label: 'y' },
      { bins: [2, 3, 2], min: 0.5, max: 1, label: 'z' },
    ],
    colorFrequencies: [
      { r: 0.5, g: 0.3, b: 0.8, freq: 0.4 },
      { r: 0.0, g: 0.1, b: 0.2, freq: 0.3 },
      { r: 1.0, g: 0.7, b: 0.5, freq: 0.2 },
      { r: 0.2, g: 0.5, b: 0.1, freq: 0.1 },
    ],
    thumbnail: null,
    gridWidth: 32,
    gridHeight: 32,
    declarationLine: 0,
  };
}

describe('VariableRow', () => {
  it('renders float value in pixel mode as single number', () => {
    render(VariableRow, {
      props: { variable: makeFloatVar(0.342), isPixelMode: true },
    });
    const content = document.body.textContent ?? '';
    expect(content).toContain('0.342');
    expect(content).toContain('myFloat');
    expect(content).toContain('float');
  });

  it('renders vec3 value in pixel mode as "(x, y, z)"', () => {
    render(VariableRow, {
      props: { variable: makeVec3Var(0.21, 0.45, 0.80), isPixelMode: true },
    });
    const content = document.body.textContent ?? '';
    expect(content).toContain('0.210');
    expect(content).toContain('0.450');
    expect(content).toContain('0.800');
    expect(content).toContain('myVec3');
  });

  it('shows color swatch for vec3 in pixel mode', () => {
    render(VariableRow, {
      props: { variable: makeVec3Var(0.21, 0.45, 0.80), isPixelMode: true },
    });
    const swatch = document.querySelector('.color-swatch') as HTMLElement;
    expect(swatch).toBeInTheDocument();
    expect(swatch.style.backgroundColor).toBeTruthy();
  });

  it('shows min/max/mean in grid mode for scalar', () => {
    render(VariableRow, {
      props: { variable: makeGridScalarVar(), isPixelMode: false },
    });
    const content = document.body.textContent ?? '';
    expect(content).toContain('-0.500');
    expect(content).toContain('1.200');
    expect(content).toContain('0.300');
  });

  it('shows per-component means with ≈ prefix for vec3 in grid mode', () => {
    render(VariableRow, {
      props: { variable: makeGridVecVar(), isPixelMode: false },
    });
    const content = document.body.textContent ?? '';
    expect(content).toContain('≈');
    expect(content).toContain('0.210');
    expect(content).toContain('0.450');
    expect(content).toContain('0.800');
  });

  it('shows thumbnail canvas for vec3 in grid mode when thumbnail data is present', () => {
    const thumb = new Uint8ClampedArray(32 * 32 * 4).fill(128);
    const v = { ...makeGridVecVar(), thumbnail: thumb };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const canvas = document.querySelector('canvas') as HTMLElement;
    expect(canvas).toBeInTheDocument();
  });

  it('shows non-square thumbnail canvas for wide aspect ratio grid', () => {
    // 43×24 = ~16:9
    const thumb = new Uint8ClampedArray(43 * 24 * 4).fill(128);
    const v = { ...makeGridVecVar(), thumbnail: thumb, gridWidth: 43, gridHeight: 24 };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    // Width should be maxSize (32), height proportionally shorter
    expect(canvas.style.width).toBe('32px');
    const expectedHeight = Math.round(32 * (24 / 43));
    expect(canvas.style.height).toBe(`${expectedHeight}px`);
  });

  it('shows non-square thumbnail canvas for tall aspect ratio grid', () => {
    // 24×43 = ~9:16
    const thumb = new Uint8ClampedArray(24 * 43 * 4).fill(128);
    const v = { ...makeGridVecVar(), thumbnail: thumb, gridWidth: 24, gridHeight: 43 };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.style.height).toBe('32px');
    const expectedWidth = Math.round(32 * (24 / 43));
    expect(canvas.style.width).toBe(`${expectedWidth}px`);
  });

  it('shows expand button in grid mode for scalar', () => {
    render(VariableRow, {
      props: { variable: makeGridScalarVar(), isPixelMode: false },
    });
    const btn = document.querySelector('.expand-btn');
    expect(btn).toBeInTheDocument();
  });

  it('shows expand button for vec types in grid mode', () => {
    render(VariableRow, {
      props: { variable: makeGridVecVar(), isPixelMode: false },
    });
    const btn = document.querySelector('.expand-btn');
    expect(btn).toBeInTheDocument();
  });

  it('calls onExpandToggle when expand button clicked (scalar)', async () => {
    const onExpandToggle = vi.fn();
    render(VariableRow, {
      props: { variable: makeGridScalarVar(), isPixelMode: false, onExpandToggle },
    });
    const btn = document.querySelector('.expand-btn') as HTMLElement;
    await fireEvent.click(btn);
    expect(onExpandToggle).toHaveBeenCalledOnce();
  });

  it('calls onExpandToggle when expand button clicked (vec)', async () => {
    const onExpandToggle = vi.fn();
    render(VariableRow, {
      props: { variable: makeGridVecVar(), isPixelMode: false, onExpandToggle },
    });
    const btn = document.querySelector('.expand-btn') as HTMLElement;
    await fireEvent.click(btn);
    expect(onExpandToggle).toHaveBeenCalledOnce();
  });

  it('renders greyscale bar and histogram when scalar expanded', () => {
    render(VariableRow, {
      props: { variable: makeExpandedVar(), isPixelMode: false },
    });
    // MiniHistogram renders an SVG; GreyscaleFrequencyBar renders .segment divs
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const segments = document.querySelectorAll('.segment');
    expect(segments.length).toBeGreaterThanOrEqual(1);
  });

  it('renders color frequency bar and channel histograms for expanded vec variable', () => {
    render(VariableRow, {
      props: { variable: makeExpandedVecVar(), isPixelMode: false },
    });
    // ColorFrequencyBar renders colored div segments
    const segments = document.querySelectorAll('.segment');
    expect(segments.length).toBeGreaterThanOrEqual(1);
    // MultiChannelHistogram renders one SVG per channel
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it('shows exact values for constant vec without expand button', () => {
    render(VariableRow, {
      props: { variable: makeConstantVecVar(), isPixelMode: false },
    });
    const content = document.body.textContent ?? '';
    expect(content).toContain('233223.000');
    expect(content).toContain('0.000');
    const btn = document.querySelector('.expand-btn');
    expect(btn).not.toBeInTheDocument();
  });

  it('renders color frequency bar for expanded vec2 variable', () => {
    const vec2Var: CapturedVariable = {
      varName: 'uv', varType: 'vec2', value: null,
      channelMeans: [0.5, 0.5],
      channelStats: [{ min: 0, max: 1, mean: 0.5 }, { min: 0, max: 1, mean: 0.5 }],
      stats: null, histogram: null, channelHistograms: null,
      colorFrequencies: [
        { r: 0.5, g: 0.5, b: 0.0, freq: 0.6 },
        { r: 0.0, g: 0.1, b: 0.0, freq: 0.4 },
      ],
      thumbnail: null, gridWidth: 32, gridHeight: 32, declarationLine: 0,
    };
    render(VariableRow, { props: { variable: vec2Var, isPixelMode: false } });
    const segments = document.querySelectorAll('.segment');
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it('renders mat2 in pixel mode as 4-component value', () => {
    const mat2Var: CapturedVariable = {
      varName: 'myMat', varType: 'mat2', value: [1.0, 0.0, 0.0, 1.0],
      channelMeans: null, channelStats: null, stats: null,
      histogram: null, ...NULL_FIELDS,
    };
    render(VariableRow, { props: { variable: mat2Var, isPixelMode: true } });
    const content = document.body.textContent ?? '';
    expect(content).toContain('myMat');
    expect(content).toContain('mat2');
    expect(content).toContain('1.000');
    expect(content).toContain('0.000');
  });

  it('renders mat2 in grid mode with channel means', () => {
    const mat2Grid: CapturedVariable = {
      varName: 'myMat', varType: 'mat2', value: null,
      channelMeans: [0.9, 0.1, 0.1, 0.9],
      channelStats: [
        { min: 0.8, max: 1.0, mean: 0.9 },
        { min: 0.0, max: 0.2, mean: 0.1 },
        { min: 0.0, max: 0.2, mean: 0.1 },
        { min: 0.8, max: 1.0, mean: 0.9 },
      ],
      stats: null, histogram: null, ...NULL_FIELDS,
    };
    render(VariableRow, { props: { variable: mat2Grid, isPixelMode: false } });
    const content = document.body.textContent ?? '';
    expect(content).toContain('≈');
    expect(content).toContain('0.900');
    expect(content).toContain('0.100');
    const btn = document.querySelector('.expand-btn');
    expect(btn).toBeInTheDocument();
  });

  it('shows line number for variable with valid declarationLine', () => {
    const v = { ...makeFloatVar(0.5), declarationLine: 6 };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    expect(document.body.textContent).toContain('L7');
  });

  it('does not show line number when declarationLine is -1', () => {
    const v = { ...makeFloatVar(0.5), declarationLine: -1 };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const lineEl = document.querySelector('.var-line');
    expect(lineEl).not.toBeInTheDocument();
  });

  it('var-name is not clickable', () => {
    render(VariableRow, { props: { variable: makeFloatVar(0.5), isPixelMode: false } });
    expect(document.querySelector('.var-name.clickable')).not.toBeInTheDocument();
  });

  it('keeps long variable names constrained and exposes full name via title', () => {
    const v = {
      ...makeFloatVar(0.5),
      varName: 'this_is_a_very_long_variable_name_that_should_not_overlap_vec3',
      varType: 'vec3',
    };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const nameEl = document.querySelector('.var-name') as HTMLElement;
    const metaEl = document.querySelector('.var-meta') as HTMLElement;
    const typeEl = document.querySelector('.var-type') as HTMLElement;

    expect(nameEl).toHaveAttribute('title', v.varName);
    expect(metaEl).toBeInTheDocument();
    expect(typeEl.textContent).toBe('vec3');
  });

  it('reserves the preview column width when thumbnail is shown', () => {
    const thumb = new Uint8ClampedArray(32 * 32 * 4).fill(128);
    const v = { ...makeGridVecVar(), thumbnail: thumb };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const thumbCol = document.querySelector('.thumb-col') as HTMLElement;
    expect(thumbCol).toBeInTheDocument();
    expect(thumbCol.querySelector('canvas')).toBeInTheDocument();
    expect(thumbCol.nextElementSibling).toHaveClass('var-body');
  });

  it('calls onLineClick when line number is clicked', async () => {
    const onLineClick = vi.fn();
    const v = { ...makeFloatVar(0.5), declarationLine: 4 };
    render(VariableRow, { props: { variable: v, isPixelMode: false, onLineClick } });
    const lineEl = document.querySelector('.var-line') as HTMLElement;
    expect(lineEl).toBeInTheDocument();
    await fireEvent.click(lineEl);
    expect(onLineClick).toHaveBeenCalledOnce();
  });

  it('calls onLineClick via keyboard Enter on line number', async () => {
    const onLineClick = vi.fn();
    const v = { ...makeFloatVar(0.5), declarationLine: 2 };
    render(VariableRow, { props: { variable: v, isPixelMode: false, onLineClick } });
    const lineEl = document.querySelector('.var-line') as HTMLElement;
    await fireEvent.keyDown(lineEl, { key: 'Enter' });
    expect(onLineClick).toHaveBeenCalledOnce();
  });

  it('does not call onLineClick for non-Enter keyboard keys', async () => {
    const onLineClick = vi.fn();
    const v = { ...makeFloatVar(0.5), declarationLine: 4 };
    render(VariableRow, { props: { variable: v, isPixelMode: false, onLineClick } });
    const lineEl = document.querySelector('.var-line') as HTMLElement;
    for (const key of [' ', 'Space', 'ArrowUp', 'ArrowDown', 'Tab', 'a', 'Escape']) {
      await fireEvent.keyDown(lineEl, { key });
    }
    expect(onLineClick).not.toHaveBeenCalled();
  });

  it('line badge has role=button and tabindex=0', () => {
    const v = { ...makeFloatVar(0.5), declarationLine: 3 };
    render(VariableRow, { props: { variable: v, isPixelMode: false } });
    const lineEl = document.querySelector('.var-line') as HTMLElement;
    expect(lineEl).toHaveAttribute('role', 'button');
    expect(lineEl).toHaveAttribute('tabindex', '0');
  });

  it('shows dash placeholder when no value and no stats', () => {
    const loadingVar: CapturedVariable = {
      varName: 'x', varType: 'float', value: null,
      channelMeans: null, channelStats: null, stats: null,
      histogram: null, ...NULL_FIELDS,
    };
    render(VariableRow, {
      props: { variable: loadingVar, isPixelMode: true },
    });
    const content = document.body.textContent ?? '';
    expect(content).toContain('—');
  });
});
