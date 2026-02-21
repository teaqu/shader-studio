import { render, fireEvent, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import ParameterEditor from '../../../lib/components/debug/ParameterEditor.svelte';
import type { DebugParameterInfo } from '../../../lib/types/ShaderDebugState';

function makeParam(overrides: Partial<DebugParameterInfo> = {}): DebugParameterInfo {
  return {
    name: 'testParam',
    type: 'float',
    uvValue: 'uv.x',
    centeredUvValue: '((fragCoord * 2.0 - iResolution.xy) / iResolution.y).x',
    defaultCustomValue: '0.5',
    mode: 'custom',
    customValue: '0.5',
    ...overrides,
  };
}

describe('ParameterEditor', () => {
  describe('Basic rendering', () => {
    it('should render parameter name and type', () => {
      const param = makeParam({ name: 'myColor', type: 'vec3' });
      const { container } = render(ParameterEditor, { param });

      const nameEl = container.querySelector('.param-name');
      const typeEl = container.querySelector('.param-type');
      expect(nameEl).toBeTruthy();
      expect(nameEl?.textContent).toBe('myColor');
      expect(typeEl).toBeTruthy();
      expect(typeEl?.textContent).toBe('vec3');
    });
  });

  describe('Mode dropdown', () => {
    it('should show UV and Custom options for non-sampler types', () => {
      const param = makeParam({ type: 'float' });
      render(ParameterEditor, { param });

      const modeSelect = screen.getByLabelText('Parameter mode for testParam') as HTMLSelectElement;
      expect(modeSelect).toBeTruthy();

      const options = Array.from(modeSelect.querySelectorAll('option'));
      const optionValues = options.map(o => o.value);
      expect(optionValues).toContain('uv');
      expect(optionValues).toContain('custom');
    });

    it('should default vec2 to UV mode', () => {
      const param = makeParam({ type: 'vec2', mode: 'uv', uvValue: 'uv', defaultCustomValue: 'vec2(0.5, 0.5)' });
      const { container } = render(ParameterEditor, { param });

      // In UV mode, no custom inputs should be shown
      expect(container.querySelector('.value-input')).toBeFalsy();
    });

    it('should default float to Custom mode', () => {
      const param = makeParam({ type: 'float', mode: 'custom' });
      const { container } = render(ParameterEditor, { param });

      // In custom mode, float inputs should be shown
      const numberInput = screen.getByLabelText('Float value for testParam');
      expect(numberInput).toBeTruthy();
    });
  });

  describe('Float custom mode', () => {
    it('should show number input and range slider', () => {
      const param = makeParam({ type: 'float', mode: 'custom', defaultCustomValue: '0.5' });
      render(ParameterEditor, { param });

      const numberInput = screen.getByLabelText('Float value for testParam') as HTMLInputElement;
      const slider = screen.getByLabelText('Float slider for testParam') as HTMLInputElement;
      expect(numberInput).toBeTruthy();
      expect(numberInput.type).toBe('number');
      expect(slider).toBeTruthy();
      expect(slider.type).toBe('range');
    });
  });

  describe('Vec3 custom mode', () => {
    it('should show 3 number inputs and color picker', () => {
      const param = makeParam({
        type: 'vec3',
        mode: 'custom',
        defaultCustomValue: 'vec3(0.5, 0.3, 0.1)',
      });
      render(ParameterEditor, { param });

      const rInput = screen.getByLabelText('R value') as HTMLInputElement;
      const gInput = screen.getByLabelText('G value') as HTMLInputElement;
      const bInput = screen.getByLabelText('B value') as HTMLInputElement;
      expect(rInput).toBeTruthy();
      expect(rInput.type).toBe('number');
      expect(gInput).toBeTruthy();
      expect(gInput.type).toBe('number');
      expect(bInput).toBeTruthy();
      expect(bInput.type).toBe('number');

      const colorPicker = screen.getByLabelText('Color picker for testParam') as HTMLInputElement;
      expect(colorPicker).toBeTruthy();
      expect(colorPicker.type).toBe('color');
    });
  });

  describe('Bool custom mode', () => {
    it('should show checkbox', () => {
      const param = makeParam({
        type: 'bool',
        mode: 'custom',
        defaultCustomValue: 'false',
      });
      render(ParameterEditor, { param });

      const checkbox = screen.getByLabelText('Bool value for testParam') as HTMLInputElement;
      expect(checkbox).toBeTruthy();
      expect(checkbox.type).toBe('checkbox');
    });
  });

  describe('sampler2D', () => {
    it('should show channel dropdown and no UV mode option', () => {
      const param = makeParam({
        type: 'sampler2D',
        mode: 'custom',
        defaultCustomValue: 'iChannel0',
        uvValue: '',
      });
      const { container } = render(ParameterEditor, { param });

      // Channel select should be present
      const channelSelect = screen.getByLabelText('Channel for testParam') as HTMLSelectElement;
      expect(channelSelect).toBeTruthy();

      const channelOptions = Array.from(channelSelect.querySelectorAll('option'));
      const channelValues = channelOptions.map(o => o.value);
      expect(channelValues).toContain('iChannel0');
      expect(channelValues).toContain('iChannel1');
      expect(channelValues).toContain('iChannel2');
      expect(channelValues).toContain('iChannel3');

      // Mode dropdown should not be shown for sampler2D
      const modeSelect = container.querySelector('.mode-select');
      expect(modeSelect).toBeFalsy();
    });
  });

  describe('onChange callback', () => {
    it('should call onChange with UV value when in UV mode initially', () => {
      const onChange = vi.fn();
      const param = makeParam({
        type: 'vec2',
        mode: 'uv',
        uvValue: 'uv',
        defaultCustomValue: 'vec2(0.5, 0.5)',
      });
      render(ParameterEditor, { param, onChange });

      // Switch mode to trigger emitValue - select UV mode via the dropdown
      const modeSelect = screen.getByLabelText('Parameter mode for testParam') as HTMLSelectElement;
      fireEvent.change(modeSelect, { target: { value: 'uv' } });

      expect(onChange).toHaveBeenCalledWith('uv');
    });

    it('should call onChange with correct GLSL string for float custom', async () => {
      const onChange = vi.fn();
      const param = makeParam({
        type: 'float',
        mode: 'custom',
        defaultCustomValue: '0.5',
      });
      render(ParameterEditor, { param, onChange });

      const numberInput = screen.getByLabelText('Float value for testParam') as HTMLInputElement;
      await fireEvent.input(numberInput, { target: { value: '0.75' } });

      expect(onChange).toHaveBeenCalledWith('0.75');
    });
  });

  describe('parseVecComponents', () => {
    it('should handle "vec3(0.5)" correctly without matching digits in type name', () => {
      // If parseVecComponents naively matched digits, it would pick up "3" from "vec3"
      // The correct behavior extracts content inside parentheses first
      const onChange = vi.fn();
      const param = makeParam({
        type: 'vec3',
        mode: 'custom',
        defaultCustomValue: 'vec3(0.5)',
      });
      render(ParameterEditor, { param, onChange });

      // vec3(0.5) should expand single value to all 3 components: [0.5, 0.5, 0.5]
      const rInput = screen.getByLabelText('R value') as HTMLInputElement;
      const gInput = screen.getByLabelText('G value') as HTMLInputElement;
      const bInput = screen.getByLabelText('B value') as HTMLInputElement;
      expect(parseFloat(rInput.value)).toBe(0.5);
      expect(parseFloat(gInput.value)).toBe(0.5);
      expect(parseFloat(bInput.value)).toBe(0.5);
    });
  });

  describe('Centered UV mode', () => {
    it('should show Centered UV option in mode dropdown', () => {
      const param = makeParam({ type: 'vec2' });
      render(ParameterEditor, { param });

      const modeSelect = screen.getByLabelText('Parameter mode for testParam') as HTMLSelectElement;
      const options = Array.from(modeSelect.querySelectorAll('option'));
      const optionValues = options.map(o => o.value);
      expect(optionValues).toContain('centered-uv');
    });

    it('should show "centered" label when centered-uv mode is active', () => {
      const param = makeParam({
        type: 'vec2',
        mode: 'centered-uv',
        centeredUvValue: '((fragCoord * 2.0 - iResolution.xy) / iResolution.y)',
      });
      const { container } = render(ParameterEditor, { param });

      const presetLabel = container.querySelector('.preset-label');
      expect(presetLabel).toBeTruthy();
      expect(presetLabel?.textContent).toBe('centered');
    });

    it('should emit centeredUvValue when centered-uv mode is selected', async () => {
      const onChange = vi.fn();
      const centeredUvValue = '((fragCoord * 2.0 - iResolution.xy) / iResolution.y)';
      const param = makeParam({
        type: 'vec2',
        mode: 'uv',
        centeredUvValue,
      });
      render(ParameterEditor, { param, onChange });

      const modeSelect = screen.getByLabelText('Parameter mode for testParam') as HTMLSelectElement;
      await fireEvent.change(modeSelect, { target: { value: 'centered-uv' } });

      expect(onChange).toHaveBeenCalledWith(centeredUvValue);
    });
  });

  describe('Preset mode', () => {
    it('should show presets in dropdown for float type', () => {
      const param = makeParam({ type: 'float', mode: 'custom' });
      render(ParameterEditor, { param });

      const modeSelect = screen.getByLabelText('Parameter mode for testParam') as HTMLSelectElement;
      const options = Array.from(modeSelect.querySelectorAll('option'));
      const optionValues = options.map(o => o.value);

      expect(optionValues).toContain('preset:iTime');
      expect(optionValues).toContain('preset:sin(iTime)');
      expect(optionValues).toContain('preset:cos(iTime)');
      expect(optionValues).toContain('preset:fract(iTime)');
      expect(optionValues).toContain('preset:iTimeDelta');
    });

    it('should emit preset expression when preset is selected', async () => {
      const onChange = vi.fn();
      const param = makeParam({ type: 'float', mode: 'custom' });
      render(ParameterEditor, { param, onChange });

      const modeSelect = screen.getByLabelText('Parameter mode for testParam') as HTMLSelectElement;
      await fireEvent.change(modeSelect, { target: { value: 'preset:iTime' } });

      expect(onChange).toHaveBeenCalledWith('iTime');
    });
  });

  describe('Vec per-component dropdowns', () => {
    it('should show per-component mode dropdowns for vec2 in custom mode', () => {
      const param = makeParam({
        type: 'vec2',
        mode: 'custom',
        defaultCustomValue: 'vec2(0.5, 0.3)',
      });
      render(ParameterEditor, { param });

      const xMode = screen.getByLabelText('X component mode for testParam') as HTMLSelectElement;
      const yMode = screen.getByLabelText('Y component mode for testParam') as HTMLSelectElement;
      expect(xMode).toBeTruthy();
      expect(yMode).toBeTruthy();
    });

    it('should show per-component mode dropdowns for vec3 in custom mode', () => {
      const param = makeParam({
        type: 'vec3',
        mode: 'custom',
        defaultCustomValue: 'vec3(0.5, 0.3, 0.1)',
      });
      render(ParameterEditor, { param });

      const rMode = screen.getByLabelText('R component mode for testParam') as HTMLSelectElement;
      const gMode = screen.getByLabelText('G component mode for testParam') as HTMLSelectElement;
      const bMode = screen.getByLabelText('B component mode for testParam') as HTMLSelectElement;
      expect(rMode).toBeTruthy();
      expect(gMode).toBeTruthy();
      expect(bMode).toBeTruthy();
    });

    it('should show per-component mode dropdowns for vec4 in custom mode', () => {
      const param = makeParam({
        type: 'vec4',
        mode: 'custom',
        defaultCustomValue: 'vec4(0.5, 0.3, 0.1, 1.0)',
      });
      render(ParameterEditor, { param });

      const xMode = screen.getByLabelText('X component mode for testParam') as HTMLSelectElement;
      const yMode = screen.getByLabelText('Y component mode for testParam') as HTMLSelectElement;
      const zMode = screen.getByLabelText('Z component mode for testParam') as HTMLSelectElement;
      const wMode = screen.getByLabelText('W component mode for testParam') as HTMLSelectElement;
      expect(xMode).toBeTruthy();
      expect(yMode).toBeTruthy();
      expect(zMode).toBeTruthy();
      expect(wMode).toBeTruthy();
    });

    it('should show number input only when component is in custom mode', () => {
      const param = makeParam({
        type: 'vec3',
        mode: 'custom',
        defaultCustomValue: 'vec3(0.5, 0.3, 0.1)',
      });
      render(ParameterEditor, { param });

      // All start as custom, so all should have number inputs
      expect(screen.getByLabelText('R value')).toBeTruthy();
      expect(screen.getByLabelText('G value')).toBeTruthy();
      expect(screen.getByLabelText('B value')).toBeTruthy();
    });

    it('should hide number input when component mode is preset', async () => {
      const param = makeParam({
        type: 'vec3',
        mode: 'custom',
        defaultCustomValue: 'vec3(0.5, 0.3, 0.1)',
      });
      render(ParameterEditor, { param });

      // Switch R component to a preset
      const rMode = screen.getByLabelText('R component mode for testParam') as HTMLSelectElement;
      await fireEvent.change(rMode, { target: { value: 'preset:iTime' } });

      // R input should be hidden, G and B still visible
      expect(screen.queryByLabelText('R value')).toBeFalsy();
      expect(screen.getByLabelText('G value')).toBeTruthy();
      expect(screen.getByLabelText('B value')).toBeTruthy();
    });

    it('should have component presets in dropdown', () => {
      const param = makeParam({
        type: 'vec2',
        mode: 'custom',
        defaultCustomValue: 'vec2(0.5, 0.3)',
      });
      render(ParameterEditor, { param });

      const xMode = screen.getByLabelText('X component mode for testParam') as HTMLSelectElement;
      const options = Array.from(xMode.querySelectorAll('option'));
      const values = options.map(o => o.value);

      expect(values).toContain('custom');
      expect(values).toContain('preset:iTime');
      expect(values).toContain('preset:sin(iTime)');
      expect(values).toContain('preset:uv.x');
      expect(values).toContain('preset:uv.y');
    });

    it('should emit vec with preset expression for component', async () => {
      const onChange = vi.fn();
      const param = makeParam({
        type: 'vec2',
        mode: 'custom',
        defaultCustomValue: 'vec2(0.5, 0.3)',
      });
      render(ParameterEditor, { param, onChange });

      // Switch X component to iTime preset
      const xMode = screen.getByLabelText('X component mode for testParam') as HTMLSelectElement;
      await fireEvent.change(xMode, { target: { value: 'preset:iTime' } });

      // Should emit vec2(iTime, 0.3) — first component is preset, second is custom
      expect(onChange).toHaveBeenCalledWith('vec2(iTime, 0.3)');
    });

    it('should not show component dropdowns when vec is not in custom mode', () => {
      const param = makeParam({
        type: 'vec2',
        mode: 'uv',
        uvValue: 'uv',
        defaultCustomValue: 'vec2(0.5, 0.3)',
      });
      const { container } = render(ParameterEditor, { param });

      expect(container.querySelector('.comp-mode-select')).toBeFalsy();
    });

    it('should not show component dropdowns for non-vec types', () => {
      const param = makeParam({
        type: 'float',
        mode: 'custom',
        defaultCustomValue: '0.5',
      });
      const { container } = render(ParameterEditor, { param });

      expect(container.querySelector('.comp-mode-select')).toBeFalsy();
    });
  });
});
