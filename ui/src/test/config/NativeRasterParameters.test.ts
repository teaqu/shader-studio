import { render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import NativeRasterParameters from '../../lib/components/debug/NativeRasterParameters.svelte';

it('shows the GPU-provided explanation even when the entry point has no inputs', () => {
  const view = render(NativeRasterParameters, { parameters: [] });
  expect(view.queryAllByTestId('native-raster-parameter')).toHaveLength(0);
  expect(view.getByText('Native raster inputs are provided by the GPU.')).toBeVisible();
});
