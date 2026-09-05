import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { MonacoLanguageServiceManager } from "@shader-studio/monaco";
import { getLanguageServiceSettings } from "../state/languageServiceState.svelte";

export class LanguageServiceController {
  private readonly cleanup: () => void;
  private disposed = false;

  constructor(
    private readonly manager: MonacoLanguageServiceManager,
    private readonly releaseManager: () => void = () => manager.dispose(),
  ) {
    this.cleanup = $effect.root(() => {
      $effect(() => {
        const settings = getLanguageServiceSettings();
        void manager.setEnabled("glsl", settings.glslEnabled);
        void manager.setEnabled("slang", settings.slangEnabled);
        manager.setColorDecoratorsEnabled(settings.colorDecorators);
      });
    });
  }

  syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    return this.manager.syncEnvironment(environment);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cleanup();
    this.releaseManager();
  }
}
