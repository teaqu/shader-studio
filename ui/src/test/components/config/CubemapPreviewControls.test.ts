import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import CubemapPreviewControls from '../../../lib/components/config/CubemapPreviewControls.svelte';
import { getCubemapPreview, resetCubemapPreviews, setCubemapPreview } from '../../../lib/state/cubemapPreview.svelte';

describe('CubemapPreviewControls', () => {
  beforeEach(resetCubemapPreviews);

  it('selects a face preview and updates its selected face', async () => {
    render(CubemapPreviewControls, { shaderPath: '/sky.glsl', passName: 'Sky' });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'face' } });
    await fireEvent.change(screen.getByLabelText('Cubemap face'), { target: { value: 'negative-x' } });
    expect(getCubemapPreview('/sky.glsl')).toMatchObject({ passName: 'Sky', mode: 'face', face: 'negative-x', refresh: 2 });
  });

  it('switches to layout and environment modes without showing a face selector', async () => {
    render(CubemapPreviewControls, { shaderPath: '/sky.glsl', passName: 'Sky' });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'layout' } });
    expect(screen.queryByLabelText('Cubemap face')).toBeNull();
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'environment' } });
    expect(getCubemapPreview('/sky.glsl')).toMatchObject({ mode: 'environment', refresh: 2 });
  });

  it('returns to face mode and preserves the selected face', async () => {
    render(CubemapPreviewControls, { shaderPath: '/sky.glsl', passName: 'Sky' });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'layout' } });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'face' } });
    expect(screen.getByLabelText('Cubemap face')).toBeInTheDocument();
    expect(getCubemapPreview('/sky.glsl')).toMatchObject({ mode: 'face', face: 'positive-z' });
  });

  it('starts a separate selection when another cubemap pass is active', async () => {
    setCubemapPreview('/sky.glsl', { passName: 'Other', mode: 'environment', face: 'negative-z' });
    render(CubemapPreviewControls, { shaderPath: '/sky.glsl', passName: 'Sky' });
    expect(screen.queryByLabelText('Cubemap face')).toBeNull();
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'layout' } });
    expect(getCubemapPreview('/sky.glsl')).toMatchObject({ passName: 'Sky', mode: 'layout', face: 'negative-z' });
  });

  it('returns to the regular Image output and increments the refresh revision', async () => {
    render(CubemapPreviewControls, { shaderPath: '/sky.glsl', passName: 'Sky' });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'environment' } });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'image' } });
    expect(getCubemapPreview('/sky.glsl')).toEqual({ passName: null, mode: 'face', face: 'positive-z', refresh: 2 });
  });

  it('updates selections when a reused control moves between pass and shader paths', async () => {
    const view = render(CubemapPreviewControls, { shaderPath: '/sky.glsl', passName: 'Sky' });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'face' } });
    await fireEvent.change(screen.getByLabelText('Cubemap face'), { target: { value: 'positive-x' } });
    await view.rerender({ shaderPath: '/night.glsl', passName: 'NightSky' });
    await fireEvent.change(screen.getByLabelText('Cubemap preview mode'), { target: { value: 'face' } });
    await fireEvent.change(screen.getByLabelText('Cubemap face'), { target: { value: 'negative-z' } });
    await fireEvent.change(screen.getByLabelText('Cubemap face'), { target: { value: 'positive-y' } });
    expect(getCubemapPreview('/sky.glsl')).toMatchObject({ passName: 'Sky', face: 'positive-x' });
    expect(getCubemapPreview('/night.glsl')).toMatchObject({ passName: 'NightSky', face: 'positive-y' });
  });
});
