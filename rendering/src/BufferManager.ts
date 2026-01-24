import type { PiRenderer, PiTexture, PiRenderTarget, PiShader } from "./types/piRenderer";
import type { Buffer, Buffers } from "./models";

export class BufferManager {
  private buffers: Buffers = {};
  private copyShader: PiShader | null = null;

  constructor(
    private readonly renderer: PiRenderer
  ) {
    this.copyShader = this.createCopyShader();
  }

  public createPingPongBuffers(width: number, height: number): Buffer {
    const filter = this.renderer.FILTER.LINEAR;

    const frontTex = this.createFloatTexture(width, height, filter);
    const backTex = this.createFloatTexture(width, height, filter);

    if (!frontTex || !backTex) {
      throw new Error("Failed to create ping-pong textures");
    }

    const frontRT = this.renderer.CreateRenderTarget(
      frontTex, null, null, null, null, false
    );
    const backRT = this.renderer.CreateRenderTarget(
      backTex, null, null, null, null, false
    );

    return { front: frontRT, back: backRT };
  }

  public resizeBuffers(
    newWidth: number,
    newHeight: number,
  ): void {
    const oldBuffers = this.buffers;
    const newBuffers: Buffers = {};

    for (const name of Object.keys(this.buffers)) {
      if (name !== "Image" && name !== "CommonBuffer") {
        const newBuffer = this.createPingPongBuffers(newWidth, newHeight);
        
        if (this.shouldCopyExistingBuffers(oldBuffers, name, newBuffer)) {
          this.copyExistingBuffers(oldBuffers[name]!, newBuffer);
        } else {
          this.clearNewBuffers(newBuffer, newWidth, newHeight);
        }
        
        newBuffers[name] = newBuffer;
      }
    }

    this.buffers = newBuffers;
    this.cleanupBuffers(oldBuffers);
  } 

  public getPassBuffers(): Buffers {
    return this.buffers;
  }

  public setPassBuffers(buffers: Buffers): void {
    this.buffers = buffers;
  }

  public dispose(): void {
    this.cleanupBuffers(this.buffers);
    this.buffers = {};
  }

  private createCopyShader(): PiShader | null {
    const vs = `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const fs = `
    precision highp float;
    uniform sampler2D srcTex;
    out vec4 fragColor;
    void main() {
      fragColor = texture(srcTex, gl_FragCoord.xy / vec2(textureSize(srcTex, 0)));
    }
  `;
    return this.renderer.CreateShader(vs, fs);
  }

  private createFloatTexture(width: number, height: number, filter: any): PiTexture | null {
    return this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      width,
      height,
      this.renderer.TEXFMT.C4F32,
      filter,
      this.renderer.TEXWRP.CLAMP,
      null,
    );
  }

  private shouldCopyExistingBuffers(
    oldBuffers: Buffers,
    name: string,
    newBuffers: Buffer
  ): boolean {
    return !!(oldBuffers[name] && 
             newBuffers.front?.mTex0 && 
             newBuffers.back?.mTex0);
  }

  private copyExistingBuffers(
    oldBuffer: Buffer,
    newBuffer: Buffer
  ): void {
    if (oldBuffer.front && newBuffer.front) {
      const oldFront = oldBuffer.front.mTex0;
      const oldBack = oldBuffer.back?.mTex0;

      if (oldFront && oldBack && newBuffer.front.mTex0 && newBuffer.back?.mTex0) {
        const minWidth = Math.min(oldFront.mXres, newBuffer.front.mTex0.mXres);
        const minHeight = Math.min(oldFront.mYres, newBuffer.front.mTex0.mYres);

        // Copy FRONT buffer
        this.copyTexture(oldFront, newBuffer.front, minWidth, minHeight);

        // Copy BACK buffer  
        if (newBuffer.back) {
          this.copyTexture(oldBack, newBuffer.back, minWidth, minHeight);
        }
      }
    }
  }

  private copyTexture(
    sourceTexture: PiTexture,
    targetRenderTarget: PiRenderTarget,
    width: number,
    height: number
  ): void {
    if (!sourceTexture || !this.copyShader) return;

    this.renderer.SetRenderTarget(targetRenderTarget);
    this.renderer.SetViewport([0, 0, width, height]);
    this.renderer.AttachShader(this.copyShader);
    this.renderer.SetShaderTextureUnit("srcTex", 0);
    this.renderer.AttachTextures(1, sourceTexture, null, null, null);
    
    const posLoc = this.renderer.GetAttribLocation(this.copyShader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }

  private clearNewBuffers(
    buffers: Buffer,
    width: number,
    height: number
  ): void {
    if (buffers.front) {
      this.clearRenderTarget(buffers.front, width, height);
    }
    if (buffers.back) {
      this.clearRenderTarget(buffers.back, width, height);
    }
  }

  public cleanupBuffers(buffers: Buffers): void {
    for (const key in buffers) {
      const buffer = buffers[key];
      if (buffer) {
        if (buffer.front) {
          this.cleanupRenderTarget(buffer.front);
        }
        if (buffer.back) {
          this.cleanupRenderTarget(buffer.back);
        }
      }
    }
  }

  private cleanupRenderTarget(renderTarget: PiRenderTarget): void {
    if (renderTarget.mTex0) {
      this.renderer.DestroyTexture(renderTarget.mTex0);
    }
    this.renderer.DestroyRenderTarget(renderTarget);
  }

  private clearRenderTarget( 
    renderTarget: PiRenderTarget | null,
    width: number,
    height: number
  ): void {
    if (!renderTarget) return;
    this.renderer.SetRenderTarget(renderTarget);
    this.renderer.SetViewport([0, 0, width, height]);
    this.renderer.Clear(this.renderer.CLEAR.Color, [0, 0, 0, 0]);
  }
}
 