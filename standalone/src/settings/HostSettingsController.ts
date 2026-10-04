import { StandaloneSettings } from './StandaloneSettings';

export type HostSettingsMessage = { type: string; [key: string]: unknown };

/**
 * Bridges browser-wide standalone preferences to viewer protocol messages.
 * The workspace host owns this controller because it is the process that
 * speaks to the viewer, while the transport owns the shared settings store.
 */
export class HostSettingsController {
  private settingsSnapshot: Readonly<StandaloneSettings['snapshot']>;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly settings: StandaloneSettings,
    private readonly emit: (message: HostSettingsMessage) => void,
  ) {
    this.settingsSnapshot = settings.snapshot;
    this.unsubscribe = settings.subscribe((values) => this.handleSettingsChanged(values));
  }

  dispose(): void {
    this.unsubscribe();
  }

  handleMessage(type: string, payload: Record<string, unknown>): boolean {
    if (type === 'requestShaderAuthoringSettings') {
      this.emitAuthoringSettings(); return true;
    }
    if (type === 'requestViewerCameraSettings') {
      this.emitViewerCameraSettings();
      return true;
    }
    if (type !== 'updateViewerCameraSettings') {
      return false;
    }
    if (typeof payload.useViewerCamera !== 'boolean') {
      return true;
    }
    const previous = this.settings.snapshot['webgpu.useViewerCamera'];
    const accepted = this.settings.update('webgpu.useViewerCamera', payload.useViewerCamera);
    // A changed setting is broadcast by the synchronous subscription. Reply
    // to a valid no-op too, so a newly connected viewer can always resync.
    if (!accepted || previous === payload.useViewerCamera) {
      this.emitViewerCameraSettings();
    }
    return true;
  }

  emitLanguageServiceSettings(): void {
    const settings = this.settings.snapshot;
    this.emit({
      type: 'languageServiceSettings',
      payload: {
        glslEnabled: settings['languageServers.glsl.enabled'],
        slangEnabled: settings['languageServers.slang.enabled'],
        wgslEnabled: settings['languageServers.wgsl.enabled'],
        colorDecorators: settings['editor.colorDecorators'],
        trace: 'off',
      },
    });
  }

  private handleSettingsChanged(settings: Readonly<StandaloneSettings['snapshot']>): void {
    const previous = this.settingsSnapshot;
    if (previous['webgpu.defaultRenderAuthoring'] !== settings['webgpu.defaultRenderAuthoring']) {
      this.emitAuthoringSettings();
    }
    this.settingsSnapshot = settings;
    if (previous['webgpu.useViewerCamera'] !== settings['webgpu.useViewerCamera']) {
      this.emitViewerCameraSettings();
    }
    if (previous['languageServers.glsl.enabled'] !== settings['languageServers.glsl.enabled']
      || previous['languageServers.slang.enabled'] !== settings['languageServers.slang.enabled']
      || previous['languageServers.wgsl.enabled'] !== settings['languageServers.wgsl.enabled']
      || previous['editor.colorDecorators'] !== settings['editor.colorDecorators']) {
      this.emitLanguageServiceSettings();
    }
  }

  private emitAuthoringSettings(): void {
    this.emit({ type: 'shaderAuthoringSettings', payload: { defaultRenderAuthoring: this.settings.snapshot['webgpu.defaultRenderAuthoring'] } });
  }

  private emitViewerCameraSettings(): void {
    this.emit({
      type: 'viewerCameraSettings',
      payload: { useViewerCamera: this.settings.snapshot['webgpu.useViewerCamera'] },
    });
  }
}
