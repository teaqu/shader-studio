import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { ShaderConfig } from '@shader-studio/types';
import type { Transport } from '../../lib/transport/MessageTransport';
import { ViewerCameraSettingsController } from '../../lib/config/ViewerCameraSettingsController';
import { getGlobalViewerCamera, setGlobalViewerCamera, viewerCameraRuntimeConfig } from '../../lib/state/viewerCameraState.svelte';
import ViewerCameraDefaults from '../../lib/components/config/ViewerCameraDefaults.svelte';
import PassGeometryControls from '../../lib/components/config/PassGeometryControls.svelte';

describe('viewer camera defaults', () => {
  beforeEach(() => setGlobalViewerCamera(true));

  it('applies a global opt-out only to runtime config and preserves shader overrides', () => {
    const config: ShaderConfig = { version: '1.0', webgpu: { defaultRenderAuthoring: 'native' }, passes: { Image: {} } };
    expect(viewerCameraRuntimeConfig(config)).toBe(config);
    setGlobalViewerCamera(false);
    expect(viewerCameraRuntimeConfig(config)).toEqual({ ...config, webgpu: { ...config.webgpu, useViewerCamera: false } });
    expect(config.webgpu?.useViewerCamera).toBeUndefined();
    expect(viewerCameraRuntimeConfig(null)).toBeNull();
    for (const useViewerCamera of [true, false]) {
      const explicit = { ...config, webgpu: { useViewerCamera } };
      expect(viewerCameraRuntimeConfig(explicit)).toBe(explicit);
    }
  });

  it('requests host settings, applies changes once, ignores invalid messages and stops after disposal', () => {
    let receive: (event: MessageEvent) => void = () => {};
    const transport = { onMessage: vi.fn(handler => {
      receive = handler;
    }), postMessage: vi.fn() } as unknown as Transport;
    const changed = vi.fn();
    const controller = new ViewerCameraSettingsController(transport, changed);
    expect(transport.postMessage).toHaveBeenCalledWith({ type: 'requestViewerCameraSettings' });
    const send = (type: string, useViewerCamera: unknown) => receive({ data: { type, payload: { useViewerCamera } } } as MessageEvent);
    send('other', false);
    send('viewerCameraSettings', 'false');
    expect(getGlobalViewerCamera()).toBe(true);
    send('viewerCameraSettings', false);
    send('viewerCameraSettings', false);
    expect(getGlobalViewerCamera()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    controller.dispose();
    send('viewerCameraSettings', true);
    expect(getGlobalViewerCamera()).toBe(false);
  });

  it('persists shader on/off/inherit without baking global preferences or changing passes', async () => {
    const postMessage = vi.fn();
    const onChange = vi.fn();
    const config: ShaderConfig = { version: '1.0', webgpu: { defaultRenderAuthoring: 'native', useViewerCamera: false }, passes: { Image: { useViewerCamera: true } } };
    const view = render(ViewerCameraDefaults, { config, transport: { postMessage } as unknown as Transport, shaderPath: '/a.wgsl', onChange });
    const select = view.getByLabelText('Shader viewer camera');
    expect(select).toHaveValue('off');
    await fireEvent.change(select, { target: { value: 'on' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, webgpu: { ...config.webgpu, useViewerCamera: true } });
    await fireEvent.change(select, { target: { value: 'inherit' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...config, webgpu: { defaultRenderAuthoring: 'native' } });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'updateConfig', payload: expect.objectContaining({ config: onChange.mock.calls.at(-1)![0] }) }));
    expect(view.queryByLabelText('Use viewer camera globally')).toBeNull();
    expect(postMessage.mock.calls.every(([message]) => message.type !== 'updateViewerCameraSettings')).toBe(true);
  });

  it('updates an inherited pass from the global preference and can clear an explicit override', async () => {
    const onUpdate = vi.fn();
    const view = render(PassGeometryControls, { config: {}, geometry: 'cube', showViewerCamera: true, onGeometryChange: vi.fn(), onUpdate });
    const checkbox = view.getByLabelText('Use viewer camera');
    expect(checkbox).toBeChecked();
    setGlobalViewerCamera(false);
    await tick();
    expect(checkbox).not.toBeChecked();
    await view.rerender({ config: { useViewerCamera: true } });
    expect(checkbox).toBeChecked();
    await fireEvent.click(view.getByRole('button', { name: 'Use shader default' }));
    expect(onUpdate).toHaveBeenLastCalledWith({});
  });
});
