// @vitest-environment jsdom
import { render, fireEvent, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import ParameterEditor from '../../../lib/components/debug/ParameterEditor.svelte';
import type { DebugParameterInfo } from '../../../lib/types/ShaderDebugState';

vi.mock('codejar', () => ({
  CodeJar: (el: HTMLElement, highlight: (el: HTMLElement) => void) => {
    let onUpdateCb: ((code: string) => void) | null = null;
    el.setAttribute('contenteditable', 'true');
    el.addEventListener('input', () => {
      const code = el.textContent || '';
      highlight(el);
      onUpdateCb?.(code);
    });
    return {
      updateCode: (code: string) => { el.textContent = code; highlight(el); },
      onUpdate: (cb: (code: string) => void) => { onUpdateCb = cb; },
      toString: () => el.textContent || '',
      destroy: () => {},
    };
  },
}));

function makeParam(overrides: Partial<DebugParameterInfo> = {}): DebugParameterInfo {
  return {
    name: 'testParam',
    type: 'float',
    uvValue: 'uv.x',
    centeredUvValue: '((fragCoord * 2.0 - iResolution.xy) / iResolution.y).x',
    defaultExpression: '0.5',
    expression: '0.5',
    ...overrides,
  };
}

describe('ParameterEditor', () => {
  it('renders a single expression input', () => {
    render(ParameterEditor, { param: makeParam() });
    expect(screen.getByLabelText('Expression for testParam')).toBeInTheDocument();
  });

  it('adds basic syntax highlighting for expression tokens', () => {
    const { container } = render(ParameterEditor, {
      param: makeParam({
        expression: 'sin(iTime) + 1.0',
        defaultExpression: 'sin(iTime) + 1.0',
      }),
    });

    expect(container.querySelector('.expr-fn')?.textContent).toBe('sin');
    expect(container.querySelector('.expr-uniform')?.textContent).toBe('iTime');
    expect(container.querySelector('.expr-number')?.textContent).toBe('1.0');
  });

  it('emits arbitrary float expressions directly', async () => {
    const onChange = vi.fn();
    render(ParameterEditor, { param: makeParam(), onChange });

    const el = screen.getByLabelText('Expression for testParam');
    el.textContent = 'sin(iTime)';
    await fireEvent.input(el);

    expect(onChange).toHaveBeenCalledWith('sin(iTime)');
  });

  it('resyncs visible value when parent expression resets to default', async () => {
    const { rerender } = render(ParameterEditor, {
      param: makeParam({
        expression: 'sin(iTime)',
        defaultExpression: '0.5',
      }),
    });

    const el = screen.getByLabelText('Expression for testParam');
    expect(el.textContent).toBe('sin(iTime)');

    await rerender({
      param: makeParam({
        expression: '0.5',
        defaultExpression: '0.5',
      }),
    });

    expect(el.textContent).toBe('0.5');
  });

  it('resets the float slider when parent expression resets to default', async () => {
    const { rerender } = render(ParameterEditor, {
      param: makeParam({
        expression: '0.9',
        defaultExpression: '0.5',
      }),
    });

    const slider = screen.getByLabelText('Float slider for testParam') as HTMLInputElement;
    expect(slider.value).toBe('0.9');

    await rerender({
      param: makeParam({
        expression: '0.5',
        defaultExpression: '0.5',
      }),
    });

    expect(slider.value).toBe('0.5');
  });

  it('normalizes vec3 comma shorthand into vec3(...)', async () => {
    const onChange = vi.fn();
    render(ParameterEditor, {
      param: makeParam({
        type: 'vec3',
        defaultExpression: 'vec3(0.5)',
        expression: 'vec3(0.5)',
        uvValue: 'vec3(uv, 0.0)',
        centeredUvValue: 'vec3(((fragCoord * 2.0 - iResolution.xy) / iResolution.y), 0.0)',
      }),
      onChange,
    });

    const el = screen.getByLabelText('Expression for testParam');
    el.textContent = '0.0, 0.0, 0.0';
    await fireEvent.input(el);

    expect(onChange).toHaveBeenCalledWith('vec3(0.0, 0.0, 0.0)');
  });

  it('keeps a single slider row for float parameters', () => {
    render(ParameterEditor, { param: makeParam() });
    expect(screen.getByLabelText('Float slider for testParam')).toBeInTheDocument();
    expect(screen.queryByLabelText('Float value for testParam')).not.toBeInTheDocument();
  });

  it('keeps color picker for vec3 parameters', () => {
    render(ParameterEditor, {
      param: makeParam({
        type: 'vec3',
        defaultExpression: 'vec3(0.5, 0.3, 0.1)',
        expression: 'vec3(0.5, 0.3, 0.1)',
        uvValue: 'vec3(uv, 0.0)',
        centeredUvValue: 'vec3(((fragCoord * 2.0 - iResolution.xy) / iResolution.y), 0.0)',
      }),
    });

    expect(screen.getByLabelText('Color picker for testParam')).toBeInTheDocument();
    expect(screen.queryByLabelText('R value')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('G value')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('B value')).not.toBeInTheDocument();
  });

  it('formats color picker values to two decimals', async () => {
    const onChange = vi.fn();
    render(ParameterEditor, {
      param: makeParam({
        type: 'vec3',
        defaultExpression: 'vec3(0.5, 0.3, 0.1)',
        expression: 'vec3(0.5, 0.3, 0.1)',
        uvValue: 'vec3(uv, 0.0)',
        centeredUvValue: 'vec3(((fragCoord * 2.0 - iResolution.xy) / iResolution.y), 0.0)',
      }),
      onChange,
    });

    await fireEvent.input(screen.getByLabelText('Color picker for testParam'), {
      target: { value: '#808080' },
    });

    expect(onChange).toHaveBeenCalledWith('vec3(0.50, 0.50, 0.50)');
  });

  it('preset menu writes back into the expression field', async () => {
    const onChange = vi.fn();
    render(ParameterEditor, {
      param: makeParam({
        type: 'vec2',
        defaultExpression: 'uv',
        expression: 'uv',
        uvValue: 'uv',
        centeredUvValue: '((fragCoord * 2.0 - iResolution.xy) / iResolution.y)',
      }),
      onChange,
    });

    await fireEvent.click(screen.getByLabelText('Preset for testParam'));
    await fireEvent.click(screen.getByText('iMouse.xy/iResolution.xy'));

    expect(onChange).toHaveBeenCalledWith('iMouse.xy/iResolution.xy');
  });

  it('uv preset shows label "uv" but emits full expression', async () => {
    const onChange = vi.fn();
    render(ParameterEditor, {
      param: makeParam({ type: 'vec2', defaultExpression: 'vec2(0.0)', expression: 'vec2(0.0)', uvValue: 'uv', centeredUvValue: '' }),
      onChange,
    });

    await fireEvent.click(screen.getByLabelText('Preset for testParam'));
    expect(screen.getByText('uv')).toBeTruthy();
    await fireEvent.click(screen.getByText('uv'));

    expect(onChange).toHaveBeenCalledWith('fragCoord.xy/iResolution.xy');
  });

  it('uv centered preset shows label and emits centered uv expression', async () => {
    const onChange = vi.fn();
    render(ParameterEditor, {
      param: makeParam({ type: 'vec2', defaultExpression: 'vec2(0.0)', expression: 'vec2(0.0)', uvValue: 'uv', centeredUvValue: '' }),
      onChange,
    });

    await fireEvent.click(screen.getByLabelText('Preset for testParam'));
    expect(screen.getByText('uv centered')).toBeTruthy();
    await fireEvent.click(screen.getByText('uv centered'));

    expect(onChange).toHaveBeenCalledWith('(fragCoord.xy * 2.0 - iResolution.xy) / iResolution.y');
  });
});
