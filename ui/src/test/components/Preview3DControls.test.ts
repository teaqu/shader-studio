import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import Preview3DControls from '../../lib/components/preview/Preview3DControls.svelte';
import {
  getPreviewCameraResetToken,
  getPreviewSettings,
  resetPreviewSettings,
} from '../../lib/state/preview3dState.svelte';

describe('Preview3DControls', () => {
  beforeEach(() => {
    resetPreviewSettings();
  });

  it('switches preview modes with an accessible segmented control', async () => {
    const { getByRole } = render(Preview3DControls);
    const threeDimensional = getByRole('button', { name: '3D preview' });

    expect(getByRole('button', { name: '2D preview' })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(threeDimensional);

    expect(threeDimensional).toHaveAttribute('aria-pressed', 'true');
    expect(getPreviewSettings().mode).toBe('3d');
  });

  it('updates mesh and lighting choices', async () => {
    const { getByRole } = render(Preview3DControls);
    await fireEvent.click(getByRole('button', { name: '3D preview' }));
    await fireEvent.click(getByRole('button', { name: 'Sphere' }));
    await fireEvent.click(getByRole('button', { name: 'Lit' }));

    expect(getPreviewSettings()).toMatchObject({ mode: '3d', mesh: 'sphere', lighting: 'lit' });
  });

  it('converts degree fields to radians and resets mapping settings', async () => {
    const { getByRole, getByLabelText } = render(Preview3DControls);
    await fireEvent.click(getByRole('button', { name: '3D preview' }));
    await fireEvent.click(getByRole('button', { name: 'Show 3D settings' }));
    const rotation = getByLabelText('Mapping rotation') as HTMLInputElement;

    await fireEvent.input(rotation, { target: { value: '90' } });
    expect(getPreviewSettings().mapping.rotation).toBeCloseTo(Math.PI / 2);
    expect(rotation.value).toBe('90');

    await fireEvent.click(getByRole('button', { name: 'Reset mapping' }));
    expect(getPreviewSettings().mapping).toEqual({ scale: [1, 1], offset: [0, 0], rotation: 0, wrap: 'repeat' });
  });

  it('updates object transform, scene visibility, and reset view', async () => {
    const { getByRole, getByLabelText } = render(Preview3DControls);
    await fireEvent.click(getByRole('button', { name: '3D preview' }));
    await fireEvent.click(getByRole('button', { name: 'Show 3D settings' }));

    await fireEvent.input(getByLabelText('Position X'), { target: { value: '3.5' } });
    await fireEvent.input(getByLabelText('Rotation Y'), { target: { value: '45' } });
    await fireEvent.input(getByLabelText('Uniform scale'), { target: { value: '2' } });
    await fireEvent.click(getByLabelText('Show grid'));
    await fireEvent.click(getByLabelText('Show axes'));

    expect(getPreviewSettings()).toMatchObject({
      object: { position: [3.5, 0, 0], rotation: [0, Math.PI / 4, 0], scale: [2, 2, 2] },
      scene: { grid: false, axes: false },
    });

    const token = getPreviewCameraResetToken();
    await fireEvent.click(getByRole('button', { name: 'Reset view' }));
    expect(getPreviewCameraResetToken()).toBe(token + 1);
  });

  it('contains pointer, click, and keyboard events so canvas navigation is not triggered', async () => {
    const parentPointer = vi.fn();
    const parentClick = vi.fn();
    const parentKeydown = vi.fn();
    document.addEventListener('pointerdown', parentPointer);
    document.addEventListener('click', parentClick);
    document.addEventListener('keydown', parentKeydown);
    const { getByRole } = render(Preview3DControls);
    const controls = getByRole('group', { name: 'Preview mode' });

    await fireEvent.pointerDown(controls);
    await fireEvent.click(controls);
    await fireEvent.keyDown(controls, { key: 'ArrowRight' });

    expect(parentPointer).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKeydown).not.toHaveBeenCalled();
    document.removeEventListener('pointerdown', parentPointer);
    document.removeEventListener('click', parentClick);
    document.removeEventListener('keydown', parentKeydown);
  });

  it('exposes the supplied debug-unavailable explanation only in 3D mode', async () => {
    const { getByRole, queryByText, getByText } = render(Preview3DControls, {
      props: { debugUnavailableNote: 'Pixel inspector is available in 2D preview.' },
    });
    expect(queryByText('Pixel inspector is available in 2D preview.')).not.toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: '3D preview' }));
    expect(getByText('Pixel inspector is available in 2D preview.')).toBeInTheDocument();
  });
});
