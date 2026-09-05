import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import EditorOverlay from '../../lib/components/EditorOverlay.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

vi.mock('@shader-studio/monaco', () => ({
  setupMonacoGlsl: vi.fn(),
  setupMonacoSlang: vi.fn(),
  setupMonacoLanguageServices: vi.fn(() => ({
    setEnabled: vi.fn(),
    setColorDecoratorsEnabled: vi.fn(),
    syncEnvironment: vi.fn(),
    dispose: vi.fn(),
  })),
  setCompilerMarkers: vi.fn(),
}));

const transport = {
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: () => 'vscode' as const,
  isConnected: () => true,
} as Transport;

describe('EditorOverlay', () => {
  it('keeps the extension editor in overlay mode', () => {
    const { container } = render(EditorOverlay, {
      isVisible: true,
      shaderCode: 'void main() {}',
      shaderPath: '/Image.glsl',
      transport,
    });

    expect(container.querySelector('.editor-wrapper')).not.toHaveClass('pane');
  });
});
