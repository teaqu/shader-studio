export type BufferSamplerSettings = {
  filter: "linear" | "nearest";
  wrap: "clamp" | "repeat";
};

/** Per-context sampler objects keep channel settings separate from texture storage. */
export class WebGLSamplerCache {
  private readonly samplers = new Map<string, WebGLSampler>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get({ filter, wrap }: BufferSamplerSettings): WebGLSampler | null {
    const key = `${filter}:${wrap}`;
    const cached = this.samplers.get(key);
    if (cached) return cached;

    const sampler = this.gl.createSampler();
    if (!sampler) return null;
    const glFilter = filter === "nearest" ? this.gl.NEAREST : this.gl.LINEAR;
    const glWrap = wrap === "repeat" ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE;
    this.gl.samplerParameteri(sampler, this.gl.TEXTURE_MAG_FILTER, glFilter);
    this.gl.samplerParameteri(sampler, this.gl.TEXTURE_MIN_FILTER, glFilter);
    this.gl.samplerParameteri(sampler, this.gl.TEXTURE_WRAP_S, glWrap);
    this.gl.samplerParameteri(sampler, this.gl.TEXTURE_WRAP_T, glWrap);
    this.samplers.set(key, sampler);
    return sampler;
  }

  dispose(): void {
    for (const sampler of this.samplers.values()) {
      this.gl.deleteSampler(sampler);
    }
    this.samplers.clear();
  }
}
