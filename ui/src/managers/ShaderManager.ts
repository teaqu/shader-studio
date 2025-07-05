import type { PassConfig } from "./ResourceManager";
import type { RenderManager } from "./RenderManager";
import type { ShaderCompiler } from "./ShaderCompiler";
import type { ResourceManager } from "./ResourceManager";
import type { TimeManager } from "./TimeManager";

export class ShaderManager {
  private passes: PassConfig[] = [];
  private passShaders: Record<string, any> = {};
  private passBuffers: Record<string, { front: any; back: any }> = {};
  private renderManager: RenderManager;
  private shaderCompiler: ShaderCompiler;
  private resourceManager: ResourceManager;
  private timeManager: TimeManager;
  private vscode: any;
  private currentShaderRenderID = 0;
  private isHandlingMessage = false;
  private lastEvent: MessageEvent | null = null;
  private shaderName = "";

  constructor(
    renderManager: RenderManager,
    shaderCompiler: ShaderCompiler,
    resourceManager: ResourceManager,
    timeManager: TimeManager,
    vscode: any,
  ) {
    this.renderManager = renderManager;
    this.shaderCompiler = shaderCompiler;
    this.resourceManager = resourceManager;
    this.timeManager = timeManager;
    this.vscode = vscode;
  }

  public getPasses(): PassConfig[] {
    return this.passes;
  }

  public getPassShaders(): Record<string, any> {
    return this.passShaders;
  }

  public getPassBuffers(): Record<string, { front: any; back: any }> {
    return this.passBuffers;
  }

  public setPassBuffers(
    buffers: Record<string, { front: any; back: any }>,
  ): void {
    this.passBuffers = buffers;
  }

  public getCurrentShaderRenderID(): number {
    return this.currentShaderRenderID;
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public getTextureBindings(pass: PassConfig, inputManager: any): any[] {
    const defaultTexture = this.renderManager.getDefaultTexture();
    let textureBindings = [
      defaultTexture,
      defaultTexture,
      defaultTexture,
      defaultTexture,
    ];

    for (let i = 0; i < 4; i++) {
      const input = pass.inputs[`iChannel${i}`];
      if (input) {
        if (input.type === "image" && input.path) {
          const imageCache = this.resourceManager.getImageTextureCache();
          textureBindings[i] = imageCache[input.path] || defaultTexture;
        } else if (input.type === "keyboard") {
          this.renderManager.updateKeyboardTexture(
            inputManager.getKeyHeld(),
            inputManager.getKeyPressed(),
            inputManager.getKeyToggled(),
          );
          textureBindings[i] = this.renderManager.getKeyboardTexture() ||
            defaultTexture;
        } else if (input.type === "buffer") {
          if (input.source === pass.name) {
            textureBindings[i] = this.passBuffers[pass.name].front.mTex0;
          } else if (this.passBuffers[input.source]) {
            textureBindings[i] = this.passBuffers[input.source].front.mTex0;
          }
        }
      }
    }
    return textureBindings;
  }

  public async handleShaderMessage(
    event: MessageEvent,
    onLockStateChange: (locked: boolean) => void,
  ): Promise<{ running: boolean }> {
    let { type, code, config, name, buffers = {}, isLocked: incomingLocked } =
      event.data;
    this.currentShaderRenderID++;

    if (type !== "shaderSource" || this.isHandlingMessage) {
      return { running: false };
    }

    // Update lock state from extension
    if (incomingLocked !== undefined) {
      onLockStateChange(incomingLocked);
    }

    if (this.shaderName !== name) {
      this.shaderName = name;
      this.cleanup();
    }

    this.isHandlingMessage = true;
    try {
      // Keep track of old resources to clean up later by creating shallow copies
      const oldPassShaders = { ...this.passShaders };
      const oldPassBuffers = { ...this.passBuffers };

      // Prepare for the new state
      let newPasses: PassConfig[] = [];
      let newPassShaders: Record<string, any> = {};
      let newPassBuffers: Record<string, any> = {};
      let hasError = false;

      const usedConfig = config ?? {};
      const passNames = usedConfig
        ? Object.keys(usedConfig).filter((k) => k !== "version")
        : [];

      if (passNames.length === 0) {
        newPasses.push({
          name: "Image",
          shaderSrc: code,
          inputs: {},
          path: undefined,
        });
      } else {
        for (const passName of passNames) {
          const pass = usedConfig[passName];
          // Use buffer content from the message if available, otherwise use main shader code
          const shaderSrc = buffers[passName] ||
            (passName === "Image" ? code : "");

          newPasses.push({
            name: passName,
            shaderSrc,
            inputs: pass.inputs ?? {},
            path: pass.path,
          });
        }
      }

      // Compile shaders
      for (const pass of newPasses) {
        const { headerLineCount: svelteHeaderLines } = this.shaderCompiler
          .wrapShaderToyCode(pass.shaderSrc);
        const shader = this.shaderCompiler.compileShader(
          this.renderManager.getRenderer(),
          pass.shaderSrc,
        );
        if (!shader.mResult) {
          hasError = true;
          const err = this.shaderCompiler.formatShaderError(
            shader.mInfo,
            this.renderManager.getRenderer(),
            svelteHeaderLines,
          );
          this.vscode.postMessage({
            type: "error",
            payload: [`${pass.name}: ${err}`],
          });
          break;
        }
        newPassShaders[pass.name] = shader;

        if (pass.name !== "Image") {
          if (oldPassBuffers[pass.name]) {
            newPassBuffers[pass.name] = oldPassBuffers[pass.name];
            delete oldPassBuffers[pass.name];
          } else {
            newPassBuffers[pass.name] = this.renderManager
              .createPingPongBuffers(
                this.renderManager.getCanvas()?.width || 800,
                this.renderManager.getCanvas()?.height || 600,
              );
          }
        }
      }

      if (hasError) {
        for (const key in newPassShaders) {
          this.renderManager.destroyShader(newPassShaders[key]);
        }
        return { running: true };
      }

      this.passes = newPasses;
      this.passShaders = newPassShaders;
      this.passBuffers = newPassBuffers;

      // Cleanup old resources
      for (const key in oldPassShaders) {
        this.renderManager.destroyShader(oldPassShaders[key]);
      }
      for (const key in oldPassBuffers) {
        this.renderManager.destroyRenderTarget(oldPassBuffers[key].front);
        this.renderManager.destroyRenderTarget(oldPassBuffers[key].back);
        this.renderManager.destroyTexture(oldPassBuffers[key].front.mTex0);
        this.renderManager.destroyTexture(oldPassBuffers[key].back.mTex0);
      }

      // Load image textures
      await this.resourceManager.loadImageTextures(this.passes);

      this.vscode.postMessage({
        type: "log",
        payload: [`Shader compiled and linked`],
      });
      this.lastEvent = event;
      return { running: true };
    } finally {
      this.isHandlingMessage = false;
    }
  }

  public cleanup(): void {
    this.resourceManager.cleanup(this.renderManager);
    this.renderManager.cleanup();
    this.timeManager.cleanup(); // Reset the time manager
    this.currentShaderRenderID++;

    this.passes = [];
    this.passShaders = {};
    this.passBuffers = {};
  }

  public reset(onReset?: () => void): void {
    this.cleanup();
    if (this.lastEvent && onReset) {
      onReset();
    } else {
      this.vscode.postMessage({
        type: "error",
        payload: ["❌ No shader to reset"],
      });
    }
  }
}
