import { piRenderer } from "../lib/pilibs/src/piRenderer";

export class RenderManager {
  private renderer: any;
  private defaultTexture: any = null;
  private keyboardTexture: any = null;
  private keyboardBuffer = new Uint8Array(256 * 3);
  private glCanvas: HTMLCanvasElement | null = null;
  private passBuffers: Record<string, { front: any; back: any }> = {};

  public async initialize(
    gl: WebGL2RenderingContext,
    canvas: HTMLCanvasElement,
  ): Promise<boolean> {
    this.glCanvas = canvas;
    this.renderer = piRenderer();
    const success = await this.renderer.Initialize(gl);
    if (!success) {
      return false;
    }

    this.defaultTexture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      1,
      1,
      this.renderer.TEXFMT.C4I8,
      this.renderer.FILTER.NONE,
      this.renderer.TEXWRP.CLAMP,
      new Uint8Array([0, 0, 0, 255]),
    );

    return true;
  }

  public getRenderer(): any {
    return this.renderer;
  }

  public getDefaultTexture(): any {
    return this.defaultTexture;
  }

  public updateKeyboardTexture(
    keyHeld: Uint8Array,
    keyPressed: Uint8Array,
    keyToggled: Uint8Array,
  ): void {
    // Combine the three states into one buffer for uploading
    // Row 0: Held states
    this.keyboardBuffer.set(keyHeld, 0);
    // Row 1: Pressed states
    this.keyboardBuffer.set(keyPressed, 256);
    // Row 2: Toggled states
    this.keyboardBuffer.set(keyToggled, 512);

    if (!this.keyboardTexture) {
      // Create a 256x3 texture, where each row corresponds to a state
      this.keyboardTexture = this.renderer.CreateTexture(
        this.renderer.TEXTYPE.T2D,
        256,
        3,
        this.renderer.TEXFMT.C1I8,
        this.renderer.FILTER.NONE,
        this.renderer.TEXWRP.CLAMP,
        this.keyboardBuffer,
      );
    } else {
      // Update the entire texture
      this.renderer.UpdateTexture(
        this.keyboardTexture,
        0,
        0,
        256,
        3,
        this.keyboardBuffer,
      );
    }
  }

  public getKeyboardTexture(): any {
    return this.keyboardTexture;
  }

  public createPingPongBuffers(width: number, height: number) {
    // In WebGL2, linear filtering on float textures is a standard feature.
    const filter = this.renderer.FILTER.LINEAR;

    const frontTex = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      width,
      height,
      this.renderer.TEXFMT.C4F32,
      filter,
      this.renderer.TEXWRP.CLAMP,
      null,
    );
    const backTex = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      width,
      height,
      this.renderer.TEXFMT.C4F32,
      filter,
      this.renderer.TEXWRP.CLAMP,
      null,
    );

    const frontRT = this.renderer.CreateRenderTarget(
      frontTex,
      null,
      null,
      null,
      null,
      false,
    );
    const backRT = this.renderer.CreateRenderTarget(
      backTex,
      null,
      null,
      null,
      null,
      false,
    );

    return { front: frontRT, back: backRT };
  }

  public destroyTexture(texture: any): void {
    if (texture) {
      this.renderer.DestroyTexture(texture);
    }
  }

  public destroyShader(shader: any): void {
    if (shader) {
      this.renderer.DestroyShader(shader);
    }
  }

  public destroyRenderTarget(renderTarget: any): void {
    if (renderTarget) {
      this.renderer.DestroyRenderTarget(renderTarget);
    }
  }

  public setCanvas(canvas: HTMLCanvasElement): void {
    this.glCanvas = canvas;
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.glCanvas;
  }

  public setPassBuffers(
    buffers: Record<string, { front: any; back: any }>,
  ): void {
    this.passBuffers = buffers;
  }

  public getPassBuffers(): Record<string, { front: any; back: any }> {
    return this.passBuffers;
  }

  public updateCanvasSize(width: number, height: number): void {
    if (!this.glCanvas) return;

    const newWidth = Math.round(width);
    const newHeight = Math.round(height);

    if (
      this.glCanvas.width === newWidth && this.glCanvas.height === newHeight
    ) {
      return;
    }

    this.glCanvas.width = newWidth;
    this.glCanvas.height = newHeight;
  }

  public resizePassBuffers(
    passes: any[],
    newWidth: number,
    newHeight: number,
  ): Record<string, { front: any; back: any }> {
    const oldPassBuffers = this.passBuffers;
    const newPassBuffers: Record<string, { front: any; back: any }> = {};

    // Create a temporary shader to copy buffer contents.
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const fs = `
            precision highp float;
            out vec4 fragColor;
            uniform sampler2D srcTex;
            uniform vec3 iResolution;
            void main() {
                vec2 uv = gl_FragCoord.xy / iResolution.xy;
                fragColor = texture(srcTex, uv);
            }
        `;
    const copyShader = this.renderer.CreateShader(vs, fs);

    for (const pass of passes) {
      if (pass.name !== "Image") {
        const newBuffers = this.createPingPongBuffers(newWidth, newHeight);
        // If there was an old buffer for this pass, copy its content to preserve state.
        if (oldPassBuffers[pass.name] && copyShader && copyShader.mResult) {
          this.renderer.AttachShader(copyShader);
          const posLoc = this.renderer.GetAttribLocation(
            copyShader,
            "position",
          );
          this.renderer.SetShaderTextureUnit("srcTex", 0);

          // Copy the 'front' buffer which holds the previous frame's state.
          this.renderer.SetRenderTarget(newBuffers.front);
          this.renderer.SetViewport([0, 0, newWidth, newHeight]);
          this.renderer.SetShaderConstant3FV(
            "iResolution",
            new Float32Array([newWidth, newHeight, newWidth / newHeight]),
          );
          this.renderer.AttachTextures(
            1,
            oldPassBuffers[pass.name].front.mTex0,
          );
          this.renderer.DrawUnitQuad_XY(posLoc);
        }
        newPassBuffers[pass.name] = newBuffers;
      }
    }

    if (copyShader) this.renderer.DestroyShader(copyShader);

    // Clean up the old, now unused, buffers.
    for (const key in oldPassBuffers) {
      this.renderer.DestroyRenderTarget(oldPassBuffers[key].front);
      this.renderer.DestroyRenderTarget(oldPassBuffers[key].back);
      this.renderer.DestroyTexture(oldPassBuffers[key].front.mTex0);
      this.renderer.DestroyTexture(oldPassBuffers[key].back.mTex0);
    }

    this.passBuffers = newPassBuffers;
    return newPassBuffers;
  }

  public drawPass(
    pass: any,
    target: any,
    uniforms: any,
    shader: any,
    textureBindings: any[],
  ): void {
    if (!shader) return;

    if (target) {
      this.renderer.SetViewport([0, 0, target.mTex0.mXres, target.mTex0.mYres]);
    } else {
      this.renderer.SetViewport([
        0,
        0,
        this.glCanvas!.width,
        this.glCanvas!.height,
      ]);
    }

    this.renderer.SetRenderTarget(target);
    this.renderer.AttachShader(shader);

    this.renderer.SetShaderConstant3FV("iResolution", uniforms.res);
    this.renderer.SetShaderConstant1F("iTime", uniforms.time);
    this.renderer.SetShaderConstant4FV("iMouse", uniforms.mouse);
    this.renderer.SetShaderConstant1I("iFrame", uniforms.frame);

    this.renderer.AttachTextures(
      4,
      textureBindings[0],
      textureBindings[1],
      textureBindings[2],
      textureBindings[3],
    );
    this.renderer.SetShaderTextureUnit("iChannel0", 0);
    this.renderer.SetShaderTextureUnit("iChannel1", 1);
    this.renderer.SetShaderTextureUnit("iChannel2", 2);
    this.renderer.SetShaderTextureUnit("iChannel3", 3);

    const posLoc = this.renderer.GetAttribLocation(shader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }

  public cleanup(): void {
    // Clean up pass buffers
    for (const key in this.passBuffers) {
      this.renderer.DestroyRenderTarget(this.passBuffers[key].front);
      this.renderer.DestroyRenderTarget(this.passBuffers[key].back);
      this.renderer.DestroyTexture(this.passBuffers[key].front.mTex0);
      this.renderer.DestroyTexture(this.passBuffers[key].back.mTex0);
    }
    this.passBuffers = {};

    if (this.keyboardTexture) {
      this.renderer.DestroyTexture(this.keyboardTexture);
      this.keyboardTexture = null;
    }
  }
}
