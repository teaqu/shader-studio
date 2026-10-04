/**
 * Multisampled render targets for WebGL passes with `samples` above 1. The
 * pass draws into a multisampled framebuffer, which is then resolved into the
 * pass's real target with blitFramebuffer.
 *
 * A multisampled blit must copy between identical formats, and the canvas's
 * default framebuffer (created without alpha) is not RGBA8. Canvas passes
 * therefore resolve into a single-sample RGBA8 framebuffer first and blit
 * that, which may convert formats, to the canvas.
 */

/** Where a resolved pass ends up: a buffer render target or the canvas (null). */
export interface MultisampleTarget {
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
}

interface MultisampleBuffers {
  framebuffer: WebGLFramebuffer;
  color: WebGLRenderbuffer;
  depth: WebGLRenderbuffer;
  /** Single-sample RGBA8 stage for canvas passes. */
  stage: { framebuffer: WebGLFramebuffer; color: WebGLRenderbuffer } | null;
  width: number;
  height: number;
  internalFormat: GLenum;
  samples: number;
}

export class WebGLMultisampleTargets {
  private readonly buffers = new Map<string, MultisampleBuffers>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /**
   * Binds a multisampled framebuffer for the pass and returns a callback that
   * resolves it into `target`, or null when the device cannot multisample the
   * format (the caller then draws straight into the target).
   */
  public begin(key: string, target: MultisampleTarget, samples: number, internalFormat: GLenum): (() => void) | null {
    const buffers = this.acquire(key, target, samples, internalFormat);
    if (!buffers) {
      return null;
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, buffers.framebuffer);
    return () => this.resolve(buffers, target);
  }

  public dispose(): void {
    for (const buffers of this.buffers.values()) {
      this.release(buffers);
    }
    this.buffers.clear();
  }

  private resolve(buffers: MultisampleBuffers, target: MultisampleTarget): void {
    const gl = this.gl;
    const { width, height } = buffers;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, buffers.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, buffers.stage?.framebuffer ?? target.framebuffer);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    if (buffers.stage) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, buffers.stage.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  }

  private acquire(key: string, target: MultisampleTarget, samples: number, internalFormat: GLenum): MultisampleBuffers | null {
    const existing = this.buffers.get(key);
    const canvas = target.framebuffer === null;
    if (existing
      && existing.width === target.width
      && existing.height === target.height
      && existing.internalFormat === internalFormat
      && existing.samples === samples
      && (existing.stage !== null) === canvas) {
      return existing;
    }
    if (existing) {
      this.release(existing);
      this.buffers.delete(key);
    }
    const created = this.create(target, samples, internalFormat);
    if (created) {
      this.buffers.set(key, created);
    }
    return created;
  }

  private create(target: MultisampleTarget, requestedSamples: number, internalFormat: GLenum): MultisampleBuffers | null {
    const gl = this.gl;
    const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, internalFormat, gl.SAMPLES) as Int32Array | null;
    const samples = Math.min(requestedSamples, supported?.[0] ?? 0);
    if (samples < 2) {
      return null;
    }
    const { width, height } = target;
    const framebuffer = gl.createFramebuffer();
    const color = gl.createRenderbuffer();
    const depth = gl.createRenderbuffer();
    if (!framebuffer || !color || !depth) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(color);
      gl.deleteRenderbuffer(depth);
      return null;
    }
    const buffers: MultisampleBuffers = { framebuffer, color, depth, stage: null, width, height, internalFormat, samples };
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internalFormat, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    let complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (complete && target.framebuffer === null) {
      complete = this.attachStage(buffers, internalFormat);
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      this.release(buffers);
      return null;
    }
    return buffers;
  }

  /** Adds the single-sample stage a canvas pass resolves through; false when it cannot be built. */
  private attachStage(buffers: MultisampleBuffers, internalFormat: GLenum): boolean {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const color = gl.createRenderbuffer();
    if (!framebuffer || !color) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(color);
      return false;
    }
    buffers.stage = { framebuffer, color };
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, buffers.width, buffers.height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  private release(buffers: MultisampleBuffers): void {
    const gl = this.gl;
    gl.deleteFramebuffer(buffers.framebuffer);
    gl.deleteRenderbuffer(buffers.color);
    gl.deleteRenderbuffer(buffers.depth);
    if (buffers.stage) {
      gl.deleteFramebuffer(buffers.stage.framebuffer);
      gl.deleteRenderbuffer(buffers.stage.color);
    }
  }
}
