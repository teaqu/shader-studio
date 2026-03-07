import type { PiRenderer, PiTexture } from "../types/piRenderer";

export class VolumeTextureManager {
  private readonly textures: Record<string, PiTexture> = {};

  constructor(private readonly renderer: PiRenderer) {}

  /**
   * Load a 3D volume texture from a URL pointing to raw binary data.
   * Expected format: 4-byte header (uint32 width, height, depth) followed by raw RGBA pixel data,
   * or a flat binary blob where dimensions are inferred.
   */
  public async loadVolumeTexture(
    path: string,
    opts: { filter?: string; wrap?: string } = {},
  ): Promise<PiTexture> {
    // Return cached texture if already loaded
    if (this.textures[path]) {
      return this.textures[path];
    }

    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch volume data from ${path}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Try to infer dimensions: assume cubic volume with RGBA channels
    // Common Shadertoy volume textures are 32x32x32 (32768 * 4 = 131072 bytes)
    let xres: number, yres: number, zres: number;
    const totalBytes = data.length;

    // Check if the data has a simple header: first 12 bytes = 3x uint32 (width, height, depth)
    if (totalBytes > 12) {
      const headerView = new DataView(arrayBuffer);
      const headerW = headerView.getUint32(0, true);
      const headerH = headerView.getUint32(4, true);
      const headerD = headerView.getUint32(8, true);

      // Validate header: dimensions should be reasonable and data should fit
      if (
        headerW > 0 && headerW <= 512 &&
        headerH > 0 && headerH <= 512 &&
        headerD > 0 && headerD <= 512 &&
        headerW * headerH * headerD * 4 === totalBytes - 12
      ) {
        // Valid header detected
        xres = headerW;
        yres = headerH;
        zres = headerD;
        const pixelData = new Uint8Array(arrayBuffer, 12);
        return this.createVolumeTexture(path, xres, yres, zres, pixelData, opts);
      }
    }

    // No header: try to infer cubic dimensions from RGBA data
    const pixelsRGBA = totalBytes / 4;
    const cubeRoot = Math.round(Math.pow(pixelsRGBA, 1 / 3));
    if (cubeRoot * cubeRoot * cubeRoot * 4 === totalBytes) {
      xres = cubeRoot;
      yres = cubeRoot;
      zres = cubeRoot;
    } else {
      // Fallback: try grayscale (1 channel) cubic
      const cubeRootGray = Math.round(Math.pow(totalBytes, 1 / 3));
      if (cubeRootGray * cubeRootGray * cubeRootGray === totalBytes) {
        xres = cubeRootGray;
        yres = cubeRootGray;
        zres = cubeRootGray;
      } else {
        throw new Error(
          `Cannot infer 3D texture dimensions from ${totalBytes} bytes. ` +
          `Provide a file with a 12-byte header (3x uint32: width, height, depth) followed by RGBA data.`
        );
      }
    }

    return this.createVolumeTexture(path, xres, yres, zres, data, opts);
  }

  private createVolumeTexture(
    path: string,
    xres: number,
    yres: number,
    zres: number,
    data: Uint8Array,
    opts: { filter?: string; wrap?: string },
  ): PiTexture {
    const filter = this.getFilter(opts.filter);
    const wrap = this.getWrap(opts.wrap);

    // piRenderer CreateTexture for T3D: xres = width, yres = height * depth
    // The 3D texture is stored as a stack of 2D slices
    const texture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T3D,
      xres,
      yres * zres,
      this.renderer.TEXFMT.C4I8,
      filter,
      wrap,
      data,
    );

    if (!texture) {
      throw new Error(`Failed to create 3D texture for ${path}`);
    }

    // Store actual 3D dimensions for resolution queries
    texture.mXres = xres;
    texture.mYres = yres;

    this.textures[path] = texture;
    return texture;
  }

  public getVolumeTexture(path: string): PiTexture | null {
    return this.textures[path] || null;
  }

  private getFilter(filter?: string): number {
    switch (filter) {
      case "linear": return this.renderer.FILTER.LINEAR;
      case "nearest": return this.renderer.FILTER.NONE;
      case "mipmap": return this.renderer.FILTER.MIPMAP;
      default: return this.renderer.FILTER.LINEAR;
    }
  }

  private getWrap(wrap?: string): number {
    switch (wrap) {
      case "clamp": return this.renderer.TEXWRP.CLAMP;
      case "repeat": return this.renderer.TEXWRP.REPEAT;
      default: return this.renderer.TEXWRP.REPEAT;
    }
  }

  public cleanup(): void {
    for (const path in this.textures) {
      this.renderer.DestroyTexture(this.textures[path]);
    }
    Object.keys(this.textures).forEach(key => delete this.textures[key]);
  }
}
