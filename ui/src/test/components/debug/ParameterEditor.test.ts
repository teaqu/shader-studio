// @vitest-environment jsdom
import { render, fireEvent, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import ParameterEditor from '../../../lib/components/debug/ParameterEditor.svelte';
import type { DebugParameterInfo } from '../../../lib/types/ShaderDebugState';

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

    await fireEvent.input(screen.getByLabelText('Expression for testParam'), {
      target: { value: 'sin(iTime)' },
    });

    expect(onChange).toHaveBeenCalledWith('sin(iTime)');
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

    await fireEvent.input(screen.getByLabelText('Expression for testParam'), {
      target: { value: '0.0, 0.0, 0.0' },
    });

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
});
