import type { ShaderStudio } from './ShaderStudio';
import { audioStore, linearToPerceptualVolume, type AudioState } from './stores/audioStore';

export class AudioVideoController {
  private audioVolume = 1.0;
  private audioMuted = true;
  private unsubscribe: (() => void) | null = null;
  private onStateChanged: ((volume: number, muted: boolean) => void) | null = null;

  constructor(
    private getShaderStudio: () => ShaderStudio | undefined,
    onStateChanged?: (volume: number, muted: boolean) => void,
  ) {
    this.onStateChanged = onStateChanged ?? null;
    this.unsubscribe = audioStore.subscribe((state: AudioState) => {
      this.audioVolume = state.volume;
      this.audioMuted = state.muted;
      this.applyGlobalAudioState();
      this.onStateChanged?.(this.audioVolume, this.audioMuted);
    });
  }

  get volume(): number {
    return this.audioVolume;
  }

  get muted(): boolean {
    return this.audioMuted;
  }

  videoControl(path: string, action: string): void {
    const engine = this.getShaderStudio()?.getRenderingEngine();
    if (!engine) {
      return;
    }

    // Block per-video unmute when globally muted
    if (action === 'unmute' && this.audioMuted) {
      return;
    }

    engine.controlVideo(path, action as any);

    // After per-video unmute, apply the current global volume
    if (action === 'unmute') {
      engine.setGlobalVolume(linearToPerceptualVolume(this.audioVolume), false);
    }
  }

  getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    const engine = this.getShaderStudio()?.getRenderingEngine();
    return engine ? engine.getVideoState(path) : null;
  }

  audioControl(path: string, action: string): void {
    const engine = this.getShaderStudio()?.getRenderingEngine();
    if (!engine) {
      return;
    }

    // Handle seek action (format: "seek:timeInSeconds")
    if (action.startsWith('seek:')) {
      const time = parseFloat(action.substring(5));
      if (!isNaN(time)) {
        engine.seekAudio(path, time);
      }
      return;
    }

    // Handle loop region update (format: "loopRegion:start,end")
    if (action.startsWith('loopRegion:')) {
      const parts = action.substring(11).split(',');
      const start = parts[0] ? parseFloat(parts[0]) : undefined;
      const end = parts[1] ? parseFloat(parts[1]) : undefined;
      engine.updateAudioLoopRegion(path, isNaN(start as number) ? undefined : start, isNaN(end as number) ? undefined : end);
      return;
    }

    // Block per-audio unmute when globally muted
    if (action === 'unmute' && this.audioMuted) {
      return;
    }

    engine.controlAudio(path, action as any);

    // After per-audio unmute, apply the current global volume
    if (action === 'unmute') {
      engine.setGlobalVolume(linearToPerceptualVolume(this.audioVolume), false);
    }
  }

  getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    const engine = this.getShaderStudio()?.getRenderingEngine();
    return engine ? engine.getAudioState(path) : null;
  }

  getAudioFFT(type: string, path?: string): Uint8Array | null {
    const engine = this.getShaderStudio()?.getRenderingEngine();
    return engine ? engine.getAudioFFTData(type, path) : null;
  }

  setVolume(volume: number): void {
    audioStore.setVolume(volume);
  }

  toggleMute(): void {
    audioStore.toggleMute();
  }

  private applyGlobalAudioState(): void {
    const engine = this.getShaderStudio()?.getRenderingEngine();
    if (engine) {
      engine.setGlobalVolume(linearToPerceptualVolume(this.audioVolume), this.audioMuted);
    }
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
