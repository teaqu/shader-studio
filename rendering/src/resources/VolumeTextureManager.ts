import { decodeVolumeTexture, type VolumeConfigInput, type VolumeTextureData } from "@shader-studio/types";
import type { TextureBackend } from "./TextureBackend";

type Options = Pick<VolumeConfigInput, "filter" | "wrap">;
interface Entry<T> { texture: T; loaded: boolean }

export class VolumeTextureManager<T> {
  private entries = new Map<string, Entry<T>>();
  private pending = new Map<string, Promise<{ texture: T | null; warning?: string }>>();
  private generation = 0;
  constructor(private readonly backend: TextureBackend<T>) {}

  private key(path: string, options: Options): string {
    return JSON.stringify([path, options.filter ?? "linear", options.wrap ?? "repeat"]);
  }
  get(path: string, options: Options = {}): T | null {
    return this.entries.get(this.key(path, options))?.texture ?? null;
  }
  isLoaded(path: string, options: Options = {}): boolean {
    return this.entries.get(this.key(path, options))?.loaded ?? false;
  }
  load(path: string, options: Options = {}): Promise<{ texture: T | null; warning?: string }> {
    const key = this.key(path, options);
    const cached = this.entries.get(key);
    if (cached?.loaded) {
      return Promise.resolve({ texture: cached.texture });
    }
    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }
    const generation = this.generation;
    const promise = this.loadUncached(path, options, key, generation).finally(() => {
      if (generation === this.generation) {
        this.pending.delete(key);
      }
    });
    this.pending.set(key, promise);
    return promise;
  }
  private async loadUncached(path: string, options: Options, key: string, generation: number): Promise<{ texture: T | null; warning?: string }> {
    let volume: VolumeTextureData;
    let warning: string | undefined;
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      volume = decodeVolumeTexture(await response.arrayBuffer());
    } catch (error) {
      warning = `Volume loading failed: ${path}: ${error instanceof Error ? error.message : String(error)}`;
      volume = { width: 1, height: 1, depth: 1, channels: 4, data: new Uint8Array([0, 0, 0, 255]) };
    }
    if (generation !== this.generation) {
      return { texture: null };
    }
    let texture: T | null;
    try {
      texture = this.backend.createVolumeTexture(volume, options.filter ?? "linear", options.wrap ?? "repeat");
      if (!texture) {
        throw new Error("Could not allocate a 3D texture");
      }
    } catch (error) {
      warning = `Volume loading failed: ${path}: ${error instanceof Error ? error.message : String(error)}`;
      try {
        texture = this.backend.createVolumeTexture({ width: 1, height: 1, depth: 1, channels: 4, data: new Uint8Array([0, 0, 0, 255]) }, "nearest", "clamp");
      } catch {
        texture = null;
      }
    }
    if (texture) {
      const previous = this.entries.get(key);
      if (previous) {
        this.backend.destroyTexture(previous.texture);
      }
      this.entries.set(key, { texture, loaded: !warning });
    }
    return { texture, warning };
  }
  cleanup(): void {
    this.generation++;
    for (const entry of this.entries.values()) {
      this.backend.destroyTexture(entry.texture);
    }
    this.entries.clear();
    this.pending.clear();
  }
}
