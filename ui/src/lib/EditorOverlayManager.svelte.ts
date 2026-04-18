import type { Transport } from './transport/MessageTransport';
import type { RenderingEngine } from '../../../rendering/src/RenderingEngine';
import type { ShaderConfig } from '@shader-studio/types';
import {
  getEditorOverlayVisible,
  getVimMode,
  toggleEditorOverlay,
  toggleVimMode as toggleVimModeState,
} from './state/editorOverlayState.svelte';

export interface EditorOverlayCallbacks {
  onStateChanged: (state: EditorOverlayState) => void;
  onShaderCodeChanged: (code: string) => void;
  onErrors: (errors: string[]) => void;
  onClearErrors: () => void;
  onStartRenderLoop: () => void;
  getLastShaderEvent: () => MessageEvent | null;
  handleShaderMessage: (event: MessageEvent) => void;
}

export interface EditorOverlayState {
  visible: boolean;
  vimMode: boolean;
  shaderCode: string;
  bufferName: string;
  filePath: string;
  fileCode: string;
  bufferNames: string[];
}

export class EditorOverlayManager {
  private shaderCode = '';
  private shaderPath = '';
  private bufferName = 'Image';
  private filePath = '';
  private fileCode = '';
  private currentConfig: ShaderConfig | null = null;

  constructor(
    private transport: Transport,
    private getRenderingEngine: () => RenderingEngine,
    private callbacks: EditorOverlayCallbacks,
  ) {}

  getState(): EditorOverlayState {
    return {
      visible: getEditorOverlayVisible(),
      vimMode: getVimMode(),
      shaderCode: this.shaderCode,
      bufferName: this.bufferName,
      filePath: this.filePath,
      fileCode: this.fileCode,
      bufferNames: this.computeBufferNames(),
    };
  }

  get currentShaderCode(): string {
    return this.shaderCode;
  }

  setShaderSource(code: string, path: string): void {
    this.shaderCode = code;
    this.shaderPath = path;
    if (this.bufferName === 'Image') {
      this.filePath = path;
      this.fileCode = code;
      this.notifyStateChanged();
    }
  }

  setConfig(config: ShaderConfig | null): void {
    this.currentConfig = config;
    this.notifyStateChanged();
  }

  handleFileContents(path: string, code: string): void {
    this.filePath = path;
    this.fileCode = code;
    this.notifyStateChanged();
  }

  handleConfigFileSelect(bufferName: string, shaderPath: string): void {
    this.bufferName = bufferName;

    if (bufferName === 'Image') {
      this.filePath = shaderPath;
      this.fileCode = this.shaderCode;
    } else {
      this.transport.postMessage({
        type: 'requestFileContents',
        payload: { bufferName, shaderPath },
      });
    }

    this.notifyStateChanged();
  }

  async handleEditorCodeChange(code: string): Promise<void> {
    this.fileCode = code;
    this.notifyStateChanged();
  }

  async compileCurrentCode(): Promise<void> {
    const code = this.fileCode;

    if (this.bufferName === 'Image') {
      this.shaderCode = code;
      this.callbacks.onShaderCodeChanged(code);
      const lastEvent = this.callbacks.getLastShaderEvent();
      if (lastEvent) {
        const syntheticEvent = new MessageEvent('message', {
          data: { ...lastEvent.data, code },
        });
        this.callbacks.handleShaderMessage(syntheticEvent);
      }
    } else {
      const renderingEngine = this.getRenderingEngine();
      const result = await renderingEngine.updateBufferAndRecompile(this.bufferName, code);
      if (result) {
        if (result.success) {
          this.callbacks.onClearErrors();
          this.callbacks.onStartRenderLoop();
        } else {
          this.callbacks.onErrors(result.errors ? result.errors : []);
        }
      }
    }
  }

  toggle(): void {
    toggleEditorOverlay();
    this.notifyStateChanged();
  }

  toggleVimMode(): void {
    toggleVimModeState();
    this.notifyStateChanged();
  }

  private computeBufferNames(): string[] {
    const names = ['Image'];
    if (this.currentConfig?.passes) {
      for (const name of Object.keys(this.currentConfig.passes)) {
        if (name !== 'Image') {
          names.push(name);
        }
      }
    }
    return names;
  }

  private notifyStateChanged(): void {
    this.callbacks.onStateChanged(this.getState());
  }

  dispose(): void {}
}
