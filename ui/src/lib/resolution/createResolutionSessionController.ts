import { onMount } from 'svelte';
import { ResolutionSessionController, type ControllerDeps } from './ResolutionSessionController.svelte';
import { ViewerCameraSettingsController } from '../config/ViewerCameraSettingsController';

/** Own host preference subscriptions for the same lifetime as the viewer. */
export function createResolutionSessionController(deps: ControllerDeps): ResolutionSessionController {
  const controller = new ResolutionSessionController(deps);
  onMount(() => {
    const settings = new ViewerCameraSettingsController(deps.transport, () => {
      if (deps.isInitialized() && deps.hasShader() && deps.currentConfig?.webgpu?.useViewerCamera === undefined) {
        deps.recompileCurrentShader();
      }
    });
    return () => settings.dispose();
  });
  return controller;
}
