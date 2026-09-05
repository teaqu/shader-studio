import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupMonacoLanguageServices } from '@shader-studio/monaco';
import { createLanguageServiceController } from '../../lib/editor/createLanguageServiceController';
import { LanguageServiceController } from '../../lib/editor/LanguageServiceController.svelte';

describe('createLanguageServiceController', () => {
  const manager = {
    setEnabled: vi.fn(),
    setColorDecoratorsEnabled: vi.fn(),
    syncEnvironment: vi.fn(),
    dispose: vi.fn(),
  };
  const monaco = {} as Parameters<typeof createLanguageServiceController>[0];

  beforeEach(() => {
    vi.mocked(setupMonacoLanguageServices).mockClear();
    for (const method of Object.values(manager)) {
      method.mockClear();
    }
    vi.mocked(setupMonacoLanguageServices).mockReturnValue(manager as never);
  });

  it('shares one manager between concurrent editors and disposes it after the last editor closes', () => {
    const first = createLanguageServiceController(monaco);
    const second = createLanguageServiceController(monaco);

    expect(setupMonacoLanguageServices).toHaveBeenCalledTimes(1);

    first.dispose();
    expect(manager.dispose).not.toHaveBeenCalled();

    second.dispose();
    expect(manager.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes a directly owned manager', () => {
    const controller = new LanguageServiceController(manager as never);

    controller.dispose();

    expect(manager.dispose).toHaveBeenCalledTimes(1);
  });
});
