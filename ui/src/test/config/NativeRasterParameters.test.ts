import { render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import NativeRasterParameters from '../../lib/components/debug/NativeRasterParameters.svelte';

it('shows the GPU-provided explanation even when the entry point has no inputs', () => {
  const view = render(NativeRasterParameters, { parameters: [] });
  expect(view.queryAllByTestId('native-raster-parameter')).toHaveLength(0);
  expect(view.getByText('Native raster inputs are provided by the GPU.')).toBeVisible();
});

it('updates the complete input label when the selected native entry point changes', async () => {
  const parameter = (name: string, type: string) => ({ name, type, uvValue: '', centeredUvValue: '', defaultExpression: '', expression: '' });
  const view = render(NativeRasterParameters, { parameters: [parameter('position', 'vec4<f32>')] });
  expect(view.getByTestId('native-raster-parameter')).toHaveTextContent('position: vec4<f32>');
  expect(view.getByText('GPU-provided')).toBeVisible();
  await view.rerender({ parameters: [parameter('uv', 'vec2<f32>')] });
  expect(view.getByTestId('native-raster-parameter')).toHaveTextContent('uv: vec2<f32>');
  expect(view.queryByText('position: vec4<f32>')).toBeNull();
  await view.rerender({ parameters: [] });
  expect(view.queryAllByTestId('native-raster-parameter')).toHaveLength(0);
});
