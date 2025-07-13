import { piRenderer } from "../../../vendor/pilibs/src/piRenderer";

export class RenderManager {
  private renderer: any;
  private defaultTexture: any = null;
  private glCanvas: HTMLCanvasElement | null = null;

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
}
