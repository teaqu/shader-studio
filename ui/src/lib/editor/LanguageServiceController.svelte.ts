import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { MonacoLanguageServiceManager } from "@shader-studio/monaco";
import { getLanguageServiceSettings } from "../state/languageServiceState.svelte";

export class LanguageServiceController {
  private readonly cleanup: () => void;

  constructor(private readonly manager: MonacoLanguageServiceManager) {
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
    this.cleanup();
    this.manager.dispose();
  }
}
