import type { PiRenderer, PiTexture, PiRenderTarget } from "./types/piRenderer";

export interface CubemapBuffer {
  texture: [PiTexture, PiTexture];  // ping-pong cubemap textures
  target: [PiRenderTarget, PiRenderTarget];  // ping-pong render targets
  currentIndex: number;  // 0 or 1 for ping-pong
}

// Cubemap face corner vectors (from Shadertoy reference)
// Each face has 4 corners: A (top-left), B (top-right), C (bottom-right), D (bottom-left)
// Plus a 5th entry for the eye/origin position (always [0,0,0] for cubemaps)
export const CUBEMAP_CORNERS: number[][] = [
  // Face 0 (+X): A=[1,1,1]   B=[1,1,-1]  C=[1,-1,-1]  D=[1,-1,1]
  [1, 1, 1,  1, 1, -1,  1, -1, -1,  1, -1, 1,  0, 0, 0],
  // Face 1 (-X): A=[-1,1,-1] B=[-1,1,1]  C=[-1,-1,1]  D=[-1,-1,-1]
  [-1, 1, -1,  -1, 1, 1,  -1, -1, 1,  -1, -1, -1,  0, 0, 0],
  // Face 2 (+Y): A=[-1,1,-1] B=[1,1,-1]  C=[1,1,1]    D=[-1,1,1]
  [-1, 1, -1,  1, 1, -1,  1, 1, 1,  -1, 1, 1,  0, 0, 0],
  // Face 3 (-Y): A=[-1,-1,1] B=[1,-1,1]  C=[1,-1,-1]  D=[-1,-1,-1]
  [-1, -1, 1,  1, -1, 1,  1, -1, -1,  -1, -1, -1,  0, 0, 0],
  // Face 4 (+Z): A=[-1,1,1]  B=[1,1,1]   C=[1,-1,1]   D=[-1,-1,1]
  [-1, 1, 1,  1, 1, 1,  1, -1, 1,  -1, -1, 1,  0, 0, 0],
  // Face 5 (-Z): A=[1,1,-1]  B=[-1,1,-1] C=[-1,-1,-1] D=[1,-1,-1]
  [1, 1, -1,  -1, 1, -1,  -1, -1, -1,  1, -1, -1,  0, 0, 0],
];

export class CubemapBufferManager {
  private buffer: CubemapBuffer | null = null;
  private fallbackTexture: PiTexture | null = null;
  private readonly preferredResolutions = [1024, 512, 256];
  private resolution = this.preferredResolutions[0];

  constructor(private readonly renderer: PiRenderer) {}

  public createCubemapBuffer(): CubemapBuffer {
    if (this.buffer) {
      return this.buffer;
    }

    const formatsToTry = [this.renderer.TEXFMT.C4F16, this.renderer.TEXFMT.C4I8];

    for (const resolution of this.preferredResolutions) {
      for (const format of formatsToTry) {
        const tex0 = this.renderer.CreateTexture(
          this.renderer.TEXTYPE.CUBEMAP,
          resolution,
          resolution,
          format,
          this.renderer.FILTER.LINEAR,
          this.renderer.TEXWRP.CLAMP,
        );

        const tex1 = this.renderer.CreateTexture(
          this.renderer.TEXTYPE.CUBEMAP,
          resolution,
          resolution,
          format,
          this.renderer.FILTER.LINEAR,
          this.renderer.TEXWRP.CLAMP,
        );

        if (!tex0 || !tex1) {
          if (tex0) this.renderer.DestroyTexture(tex0);
          if (tex1) this.renderer.DestroyTexture(tex1);
          continue;
        }

        const target0 = this.renderer.CreateRenderTargetCubeMap(tex0, null, false);
        const target1 = this.renderer.CreateRenderTargetCubeMap(tex1, null, false);

        if (!target0 || !target1) {
          if (target0) this.renderer.DestroyRenderTarget(target0);
          if (target1) this.renderer.DestroyRenderTarget(target1);
          this.renderer.DestroyTexture(tex0);
          this.renderer.DestroyTexture(tex1);
          continue;
        }

        this.resolution = resolution;
        this.buffer = {
          texture: [tex0, tex1],
          target: [target0, target1],
          currentIndex: 0,
        };

        return this.buffer;
      }
    }

    this.ensureFallbackCubemapTexture();
    throw new Error("Failed to create cubemap textures");
  }

  private ensureFallbackCubemapTexture(): void {
    if (this.fallbackTexture) {
      return;
    }
    this.fallbackTexture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.CUBEMAP,
      1,
      1,
      this.renderer.TEXFMT.C4I8,
      this.renderer.FILTER.LINEAR,
      this.renderer.TEXWRP.CLAMP,
    );
  }

  public getBuffer(): CubemapBuffer | null {
    return this.buffer;
  }

  public getCubemapTexture(): PiTexture | null {
    if (!this.buffer) return this.fallbackTexture;
    // Return the "front" (most recently rendered) texture
    return this.buffer.texture[this.buffer.currentIndex] || this.fallbackTexture;
  }

  public getResolution(): number {
    return this.resolution;
  }

  public swapBuffers(): void {
    if (this.buffer) {
      this.buffer.currentIndex = 1 - this.buffer.currentIndex;
    }
  }

  public dispose(): void {
    if (this.buffer) {
      for (let i = 0; i < 2; i++) {
        this.renderer.DestroyRenderTarget(this.buffer.target[i]);
        this.renderer.DestroyTexture(this.buffer.texture[i]);
      }

      this.buffer = null;
    }

    if (this.fallbackTexture) {
      this.renderer.DestroyTexture(this.fallbackTexture);
      this.fallbackTexture = null;
    }
  }
}
