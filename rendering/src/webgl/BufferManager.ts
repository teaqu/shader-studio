import type { BufferOutputFormat } from "@shader-studio/types";
import type { PiRenderer, PiTexture, PiRenderTarget, PiShader } from "../types/piRenderer";
import type { Buffer, Buffers } from "../models";

export class BufferManager {
  private buffers: Buffers = {};
  private copyShader: PiShader | null = null;

  constructor(
    private readonly renderer: PiRenderer
  ) {
    this.copyShader = this.createCopyShader();
  }

  public createPingPongBuffers(
    width: number,
    height: number,
    requiresDepth: boolean = false,
    requestedFormat: BufferOutputFormat = "auto",
    outputKind: "2d" | "cubemap" = "2d",
  ): Buffer {
    const outputFormat = requestedFormat === "rgba16float" ? "rgba16float" : "rgba32float";
    const textureFormat = outputFormat === "rgba16float"
      ? this.renderer.TEXFMT.C4F16
      : this.renderer.TEXFMT.C4F32;
    const filter = this.renderer.FILTER.LINEAR;

    const frontTex = this.createFloatTexture(width, height, filter, textureFormat, outputKind);
    const backTex = this.createFloatTexture(width, height, filter, textureFormat, outputKind);

    if (!frontTex || !backTex) {
      if (frontTex) {
        this.renderer.DestroyTexture(frontTex);
      }
      if (backTex) {
        this.renderer.DestroyTexture(backTex);
      }
      throw new Error("Failed to create ping-pong textures");
    }

    const frontRT = outputKind === "cubemap"
      ? this.renderer.CreateRenderTargetCubeMap(frontTex, null, false)
      : this.renderer.CreateRenderTarget(frontTex, null, null, null, null, requiresDepth);
    const backRT = outputKind === "cubemap"
      ? this.renderer.CreateRenderTargetCubeMap(backTex, null, false)
      : this.renderer.CreateRenderTarget(backTex, null, null, null, null, requiresDepth);

    if (!frontRT || !backRT) {
      if (frontRT) {
        this.renderer.DestroyRenderTarget(frontRT);
      }
      if (backRT) {
        this.renderer.DestroyRenderTarget(backRT);
      }
      this.renderer.DestroyTexture(frontTex);
      this.renderer.DestroyTexture(backTex);
      throw new Error(`Failed to create ${outputFormat} ping-pong render targets`);
    }

    const result: Buffer = { front: frontRT, back: backRT, requiresDepth, outputFormat, outputKind };
    if (outputKind === "cubemap") {
      this.clearNewBuffers(result, width, height);
    }
    return result;
  }

  public resizeBuffers(
    newWidth: number,
    newHeight: number,
    bufferResolutions?: Record<string, { width: number; height: number }>,
  ): void {
    const oldBuffers = { ...this.buffers };
    const newBuffers: Buffers = {};

    for (const name of Object.keys(this.buffers)) {
      if (name !== "Image" && name !== "common") {
        const bufW = bufferResolutions?.[name]?.width ?? newWidth;
        const bufH = bufferResolutions?.[name]?.height ?? newHeight;
        const oldBuffer = oldBuffers[name]!;
        if (oldBuffer.outputKind === "cubemap" && oldBuffer.front?.mTex0?.mXres === bufW && oldBuffer.front.mTex0.mYres === bufH) {
          newBuffers[name] = oldBuffer;
          delete oldBuffers[name];
          continue;
        }
        const newBuffer = this.createPingPongBuffers(
          bufW, bufH, oldBuffer.requiresDepth, oldBuffer.outputFormat, oldBuffer.outputKind,
        );

        if (oldBuffer.outputKind !== "cubemap" && this.shouldCopyExistingBuffers(oldBuffers, name, newBuffer)) {
          this.copyExistingBuffers(oldBuffers[name]!, newBuffer);
        } else if (oldBuffer.outputKind !== "cubemap") {
          this.clearNewBuffers(newBuffer, bufW, bufH);
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

  private createFloatTexture(width: number, height: number, filter: number, format: number, outputKind: "2d" | "cubemap"): PiTexture | null {
    return this.renderer.CreateTexture(
      outputKind === "cubemap" ? this.renderer.TEXTYPE.CUBEMAP : this.renderer.TEXTYPE.T2D,
      width,
      height,
      format,
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
    if (!sourceTexture || !this.copyShader) {
      return;
    }

    this.renderer.SetRenderTarget(targetRenderTarget);
    this.renderer.SetViewport([0, 0, width, height]);
    this.renderer.AttachShader(this.copyShader);
    this.renderer.SetShaderTextureUnit("srcTex", 0);
    this.renderer.AttachTextures(1, sourceTexture, null, null, null);

    const posLoc = this.renderer.GetAttribLocation(this.copyShader, "position");
    this.renderer.DrawFullScreenTriangle_XY(posLoc);
  }

  private clearNewBuffers(
    buffers: Buffer,
    width: number,
    height: number
  ): void {
    if (buffers.front) {
      this.clearRenderTarget(buffers.front, width, height, buffers.outputKind);
    }
    if (buffers.back) {
      this.clearRenderTarget(buffers.back, width, height, buffers.outputKind);
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
    height: number,
    outputKind?: "2d" | "cubemap",
  ): void {
    if (!renderTarget) {
      return;
    }
    this.renderer.SetViewport([0, 0, width, height]);
    if (outputKind === "cubemap") {
      for (let face = 0; face < 6; face++) {
        this.renderer.SetRenderTargetCubeMap(renderTarget, face);
        this.renderer.Clear(this.renderer.CLEAR.Color, [0, 0, 0, 0]);
      }
    } else {
      this.renderer.SetRenderTarget(renderTarget);
      this.renderer.Clear(this.renderer.CLEAR.Color, [0, 0, 0, 0]);
    }
  }
}
