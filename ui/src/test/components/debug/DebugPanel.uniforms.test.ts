// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import DebugPanel from '../../../lib/components/debug/DebugPanel.svelte';
import type { PassUniforms } from '../../../../../rendering/src/models/PassUniforms';
import { debugPanelStore, snapshotDebugPanel } from '../../../lib/stores/debugPanelStore';
import { makeDebugState, mockUniforms } from './DebugPanel.fixtures';

const builtinNames = [
  'iTime', 'iResolution', 'iMouse', 'iFrame', 'iTimeDelta', 'iFrameRate',
  'iDate', 'iSampleRate', 'iCameraPos', 'iCameraDir',
];

const languageCases = [
  { filePath: '/shader.glsl', scriptNames: ['uLevel', 'uCalls', 'uFps', 'uFrame'] },
  { filePath: '/shader.slang', scriptNames: ['uLevel', 'uCalls', 'uFps', 'uFrame'] },
  { filePath: '/shader.wgsl', scriptNames: ['gain', 'tint', 'unused'] },
];

function uniformNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('.uniforms-section .uniform-name')).map(element => element.textContent);
}

afterEach(() => {
  debugPanelStore.setVariableInspectorEnabled(false);
  vi.unstubAllGlobals();
});

describe('DebugPanel uniforms', () => {
  it.each(languageCases)('shows only exact built-ins after enabling inspector for $filePath', async ({ filePath, scriptNames }) => {
    const hostScriptValues = Object.fromEntries(scriptNames.map((name, index) => [name, index + 0.5]));
    const view = render(DebugPanel, {
      debugState: makeDebugState({ filePath, isVariableInspectorEnabled: false }),
      getUniforms: () => mockUniforms,
      uniforms: mockUniforms,
      // Deliberately pass the legacy extra payload: DebugPanel must not create
      // rows from script values while its inspector is enabled.
      ...{ customUniformValues: hostScriptValues },
    });

    expect(view.container.querySelector('.uniforms-section')).toBeNull();
    await fireEvent.pointerDown(view.getByLabelText('Toggle variable inspector'), { pointerId: 1 });
    expect(snapshotDebugPanel().isVariableInspectorEnabled).toBe(true);

    await view.rerender({
      debugState: makeDebugState({ filePath, isVariableInspectorEnabled: true }),
      getUniforms: () => mockUniforms,
      uniforms: mockUniforms,
      ...{ customUniformValues: hostScriptValues },
    });

    expect(uniformNames(view.container)).toEqual(builtinNames);
    for (const scriptName of scriptNames) {
      expect(uniformNames(view.container)).not.toContain(scriptName);
    }
    expect(Array.from(view.container.querySelectorAll('.uniform-value')).map(element => element.textContent)).toEqual([
      '1.50', '800.0, 600.0, 1.0', '400.0, 300.0, 0.0, 0.0', '90', '0.0167', '60.0',
      '2024.0, 1.0, 15.0, 12345.0', '44100', '0.0, 0.0, 5.0', '0.0, 0.0, -1.0',
    ]);
  });

  it('reads live uniforms on subsequent animation frames and falls back when absent', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let liveUniforms: PassUniforms | null = null;
    const { container } = render(DebugPanel, {
      debugState: makeDebugState({ isVariableInspectorEnabled: true }),
      getUniforms: () => liveUniforms,
    });

    frames.shift()?.(0);
    await tick();
    expect(uniformNames(container)).toEqual([]);
    expect(container.querySelector('.uniforms-section .uniform-value')?.textContent).toBe('—');

    liveUniforms = { ...mockUniforms, time: 9.25, frame: 123 };
    frames.shift()?.(16);
    await tick();
    expect(uniformNames(container)).toEqual(builtinNames);
    expect(container.querySelector('.uniforms-section .uniform-value')?.textContent).toBe('9.25');
    expect(Array.from(container.querySelectorAll('.uniform-value')).map(element => element.textContent)).toContain('123');
  });
});
