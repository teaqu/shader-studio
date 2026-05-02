// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import DebugPanel from '../../../lib/components/debug/DebugPanel.svelte';
import type { ShaderDebugState } from '../../../lib/types/ShaderDebugState';
import type { PassUniforms } from '../../../../../rendering/src/models/PassUniforms';
import type { ShaderDebugManager } from '../../../lib/ShaderDebugManager';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDebugState(overrides: Partial<ShaderDebugState> = {}): ShaderDebugState {
  return {
    isEnabled: true,
    currentLine: 5,
    lineContent: 'float d = length(p) - r;',
    filePath: '/shaders/bufferA.glsl',
    isActive: true,
    functionContext: null,
    isLineLocked: false,
    isInlineRenderingEnabled: true,
    normalizeMode: 'off' as const,
    isStepEnabled: false,
    stepEdge: 0.5,
    debugError: null,
    isVariableInspectorEnabled: false,
    capturedVariables: [],
    activeBufferName: 'Image',
    ...overrides,
  };
}

const mockUniforms: PassUniforms = {
  time: 1.0,
  res: [800, 600, 1],
  mouse: [0, 0, 0, 0],
  frame: 0,
  timeDelta: 0.016,
  frameRate: 60,
  date: [2024, 1, 1, 0],
  channelTime: [0, 0, 0, 0],
  sampleRate: 44100,
  channelLoaded: [0, 0, 0, 0],
  cameraPos: [0, 0, 5],
  cameraDir: [0, 0, -1],
};

function makeShaderDebugManager(): ShaderDebugManager {
  return {
    toggleEnabled: vi.fn(),
    toggleLineLock: vi.fn(),
    toggleInlineRendering: vi.fn(),
    cycleNormalizeMode: vi.fn(),
    toggleStep: vi.fn(),
    setStepEdge: vi.fn(),
    toggleVariableInspector: vi.fn(),
    setCustomParameter: vi.fn(),
    setLoopMaxIterations: vi.fn(),
    resetCustomParameters: vi.fn(),
    setStateCallback: vi.fn(),
    setRecompileCallback: vi.fn(),
    setCaptureStateCallback: vi.fn(),
  } as unknown as ShaderDebugManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DebugPanel — buffer badge', () => {
  // -------------------------------------------------------------------------
  describe('badge visibility', () => {
    it('does not render a buffer badge when activeBufferName is Image', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'Image' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge).toBeNull();
    });

    it('renders a buffer badge when activeBufferName is BufferA', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'BufferA' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge).not.toBeNull();
    });

    it('renders a buffer badge when activeBufferName is BufferB', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'BufferB' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge).not.toBeNull();
    });

    it('renders a buffer badge when activeBufferName is common', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'common' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('badge content', () => {
    it('shows the correct buffer name in the badge for BufferA', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'BufferA' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge?.textContent?.trim()).toBe('BufferA');
    });

    it('shows the correct buffer name in the badge for BufferC', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'BufferC' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge?.textContent?.trim()).toBe('BufferC');
    });

    it('shows "common" in the badge for the common pass', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'common' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      const badge = container.querySelector('.buffer-badge');
      expect(badge?.textContent?.trim()).toBe('common');
    });
  });

  // -------------------------------------------------------------------------
  describe('badge updates reactively', () => {
    it('badge disappears when state updates from BufferA to Image', async () => {
      const { container, rerender } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'BufferA' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });

      expect(container.querySelector('.buffer-badge')).not.toBeNull();

      await rerender({
        debugState: makeDebugState({ activeBufferName: 'Image' }),
      });

      expect(container.querySelector('.buffer-badge')).toBeNull();
    });

    it('badge content updates when switching from BufferA to BufferB', async () => {
      const { container, rerender } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ activeBufferName: 'BufferA' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });

      await rerender({ debugState: makeDebugState({ activeBufferName: 'BufferB' }) });

      const badge = container.querySelector('.buffer-badge');
      expect(badge?.textContent?.trim()).toBe('BufferB');
    });
  });

  // -------------------------------------------------------------------------
  describe('badge when debug is disabled', () => {
    it('does not show badge when debug is disabled even if activeBufferName is set', () => {
      const { container } = render(DebugPanel, {
        props: {
          debugState: makeDebugState({ isEnabled: false, isActive: false, activeBufferName: 'BufferA' }),
          shaderDebugManager: makeShaderDebugManager(),
          uniforms: mockUniforms,
        },
      });
      // Badge should only show when debug panel is in use
      const badge = container.querySelector('.buffer-badge');
      expect(badge).toBeNull();
    });
  });
});
