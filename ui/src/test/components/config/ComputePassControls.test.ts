import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ComputePass } from '@shader-studio/types';
import ComputePassControls from '../../../lib/components/config/ComputePassControls.svelte';

function renderControls(pass: ComputePass = { type: 'compute', path: 'sim.slang' }) {
  const onCommit = vi.fn(() => ({}));
  return {
    onCommit,
    ...render(ComputePassControls, {
      pass,
      storageNames: ['particles'],
      channelNames: ['source'],
      onCommit,
    }),
  };
}

describe('ComputePassControls', () => {
  it('commits a valid count dispatch immediately while typing', async () => {
    const { getByLabelText, onCommit } = renderControls();
    await fireEvent.change(getByLabelText('Dispatch mode'), { target: { value: 'count' } });
    await fireEvent.input(getByLabelText('Element count'), { target: { value: '4096' } });

    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ dispatch: { count: 4096 } }));
  });

  it('switches dispatch modes without stale keys', async () => {
    const { getByLabelText, queryByRole, onCommit } = renderControls({ type: 'compute', path: 'sim.slang', dispatch: { count: 8 } });
    expect(queryByRole('heading', { name: 'Workgroup size' })).toBeNull();
    await fireEvent.change(getByLabelText('Dispatch mode'), { target: { value: 'workgroups' } });

    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({
      dispatch: { x: 1, y: 1, z: 1 },
    }));
    expect(queryByRole('heading', { name: 'Workgroup size' })).toBeNull();
  });

  it('keeps invalid numeric drafts local and exposes an accessible error', async () => {
    const { getByLabelText, getByRole, onCommit } = renderControls({ type: 'compute', path: 'sim.slang', dispatch: { count: 8 } });
    const count = getByLabelText('Element count');
    await fireEvent.input(count, { target: { value: '0' } });

    expect(onCommit).not.toHaveBeenCalled();
    expect(count).toHaveAttribute('aria-invalid', 'true');
    expect(getByRole('alert')).toHaveTextContent('Enter a positive integer');
  });

  it('commits repeat changes immediately', async () => {
    const { getByLabelText, onCommit } = renderControls({ type: 'compute', path: 'sim.slang', dispatchCount: 3 });
    const repeats = getByLabelText('Repeats') as HTMLInputElement;
    await fireEvent.input(repeats, { target: { value: '8' } });

    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ dispatchCount: 8 }));
  });

  it('shows and commits one-shot execution, resetting repeats to one', async () => {
    const { getByLabelText, onCommit } = renderControls({ type: 'compute', path: 'sim.slang', dispatchCount: 3 });
    expect(getByLabelText('Run once')).toHaveClass('themed-checkbox');

    await fireEvent.click(getByLabelText('Run once'));

    expect(onCommit).toHaveBeenLastCalledWith({
      type: 'compute', path: 'sim.slang', dispatchOnce: true, dispatchCount: 1,
    });
    expect(getByLabelText('Repeats')).toBeDisabled();
  });

  it('commits a selected native entrypoint', async () => {
    const onCommit = vi.fn(() => ({}));
    const { getByRole } = render(ComputePassControls, {
      pass: { type: 'compute', path: 'kernels.slang' }, storageNames: [], channelNames: [],
      entryPointNames: ['clearSamples', 'animateSamples'], onCommit,
    });

    await fireEvent.click(getByRole('radio', { name: '@compute animateSamples' }));

    expect(onCommit).toHaveBeenCalledWith({ type: 'compute', path: 'kernels.slang', entryPoints: { compute: 'animateSamples' } });
  });

  it('shows and commits a selected native entrypoint when a source has multiple entries', async () => {
    const onCommit = vi.fn(() => ({}));
    const { getByRole } = render(ComputePassControls, {
      pass: { type: 'compute', path: 'kernels.slang', entryPoint: 'clearSamples' },
      storageNames: [], channelNames: [], entryPointNames: ['clearSamples', 'animateSamples'], onCommit,
    });

    expect(getByRole('radio', { name: '@compute clearSamples' })).toBeChecked();
    await fireEvent.click(getByRole('radio', { name: '@compute animateSamples' }));
    expect(onCommit).toHaveBeenCalledWith({ type: 'compute', path: 'kernels.slang', entryPoints: { compute: 'animateSamples' } });
  });
});

describe('compute cubemap output', () => {
  it('replaces 2D resolution with six cube faces', async () => {
    const onCommit = vi.fn(() => ({}));
    const { getByLabelText } = render(ComputePassControls, { pass: { type: 'compute', path: 'cube.slang', resolution: { width: 64, height: 32 } }, language: 'slang', storageNames: [], channelNames: [], onCommit });
    await fireEvent.change(getByLabelText('Output kind'), { target: { value: 'cubemap' } });
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ outputKind: 'cubemap', outputLayers: 6, faceSize: 512, resolution: undefined }));
  });

  it('edits cube face size and hides layer selection', async () => {
    const { getByLabelText, queryByLabelText, onCommit } = renderControls({ type: 'compute', path: 'cube.slang', outputKind: 'cubemap', faceSize: 64 });
    expect(queryByLabelText('Output layers')).toBeNull();
    await fireEvent.input(getByLabelText('Cubemap face size'), { target: { value: '32' } });
    expect(onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ faceSize: 32 }));
  });

  it('disables unsupported WGSL cubemap generation', () => {
    const { getByRole } = renderControls();
    expect(getByRole('option', { name: 'Cubemap' })).toBeDisabled();
  });
});
