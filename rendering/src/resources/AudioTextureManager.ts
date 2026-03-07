import type { PiRenderer, PiTexture } from "../types/piRenderer";

interface AudioSource {
  buffer: AudioBuffer;
  sourceNode: AudioBufferSourceNode | null;
  analyser: AnalyserNode;
  gainNode: GainNode;
  texture: PiTexture;
  freqData: Uint8Array;
  waveData: Uint8Array;
  playing: boolean;
  startedAt: number;   // AudioContext.currentTime when playback started
  offsetTime: number;   // offset into the buffer when playback started
  duration: number;
}

export class AudioTextureManager {
  private audioContext: AudioContext | null = null;
  private readonly audioSources: Record<string, AudioSource> = {};
  private readonly audioLoopRegions: Record<string, { startTime: number; endTime?: number }> = {};
  private readonly initializing: Set<string> = new Set();
  private readonly textureWidth = 512;
  private readonly textureHeight = 2;

  // Per-audio user-initiated pause tracking
  private readonly userPaused: Set<string> = new Set();

  constructor(private readonly renderer: PiRenderer) {}

  private autoResumeCleanup: (() => void) | null = null;

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.setupAutoResume();
    }
    return this.audioContext;
  }

  /**
   * Register one-time document interaction listeners that resume a suspended
   * AudioContext. Browsers block AudioContexts created without a user gesture;
   * this ensures audio starts on the very first click/keypress in the webview.
   */
  private setupAutoResume(): void {
    if (!this.audioContext || typeof document === 'undefined') return;

    const resume = () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      this.removeAutoResumeListeners();
    };

    document.addEventListener('click', resume);
    document.addEventListener('keydown', resume);
    document.addEventListener('touchstart', resume);

    this.autoResumeCleanup = () => {
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
      document.removeEventListener('touchstart', resume);
    };
  }

  private removeAutoResumeListeners(): void {
    if (this.autoResumeCleanup) {
      this.autoResumeCleanup();
      this.autoResumeCleanup = null;
    }
  }

  /**
   * Resume a suspended AudioContext. Browsers suspend AudioContexts created
   * without a user gesture (autoplay policy). Call this to explicitly resume.
   */
  public async resumeAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  public getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 44100;
  }

  /** Start (or restart) an AudioBufferSourceNode for the given source */
  private startSourceNode(path: string, source: AudioSource, offset: number): void {
    // Stop existing node
    if (source.sourceNode) {
      try { source.sourceNode.stop(); } catch { /* already stopped */ }
      source.sourceNode.disconnect();
    }

    const ctx = this.audioContext;
    if (!ctx) return;

    const node = ctx.createBufferSource();
    node.buffer = source.buffer;
    node.loop = true;

    // Set loop region
    const region = this.audioLoopRegions[path];
    if (region) {
      node.loopStart = region.startTime;
      node.loopEnd = region.endTime ?? source.duration;
    } else {
      node.loopStart = 0;
      node.loopEnd = source.duration;
    }

    node.connect(source.analyser);
    source.sourceNode = node;
    source.startedAt = ctx.currentTime;
    source.offsetTime = offset;

    node.start(0, offset);
    source.playing = true;
  }

  public async loadAudioSource(path: string, options?: { muted?: boolean; volume?: number; startTime?: number; endTime?: number }): Promise<PiTexture> {
    if (this.audioSources[path]) {
      return this.audioSources[path].texture;
    }

    const ctx = this.ensureAudioContext();

    this.initializing.add(path);

    // Create analyser + gain nodes
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; // frequencyBinCount = 512
    analyser.smoothingTimeConstant = 0.5;

    const gainNode = ctx.createGain();
    const muted = options?.muted ?? false;
    const volume = options?.volume ?? 1.0;
    gainNode.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume));

    analyser.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Create 512x2 C1I8 texture (row 0 = FFT, row 1 = waveform)
    const texture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      this.textureWidth,
      this.textureHeight,
      this.renderer.TEXFMT.C1I8,
      this.renderer.FILTER.LINEAR,
      this.renderer.TEXWRP.CLAMP,
      null,
    );

    if (!texture) {
      this.initializing.delete(path);
      throw new Error("Failed to create audio texture");
    }

    const freqData = new Uint8Array(this.textureWidth);
    const waveData = new Uint8Array(this.textureWidth);

    // Set up loop region
    const startTime = options?.startTime;
    const endTime = options?.endTime;

    if (startTime != null || endTime != null) {
      this.audioLoopRegions[path] = { startTime: startTime ?? 0, endTime };
    }

    // Fetch and decode audio data (same approach as waveformCache — avoids CORS issues)
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const source: AudioSource = {
        buffer: audioBuffer,
        sourceNode: null,
        analyser,
        gainNode,
        texture,
        freqData,
        waveData,
        playing: false,
        startedAt: 0,
        offsetTime: startTime ?? 0,
        duration: audioBuffer.duration,
      };

      this.audioSources[path] = source;
      this.initializing.delete(path);

      // Start playback
      this.startSourceNode(path, source, startTime ?? 0);
    } catch (error) {
      console.warn(`Failed to load audio: ${path}`, error);
      this.initializing.delete(path);
      // Still register the source entry with empty buffer so texture exists
      // but no playback will occur
    }

    return texture;
  }

  public getAudioTexture(path: string): PiTexture | null {
    return this.audioSources[path]?.texture ?? null;
  }

  public hasAudioSource(path: string): boolean {
    return path in this.audioSources;
  }

  public pauseAudio(path: string): void {
    const source = this.audioSources[path];
    if (source && source.playing) {
      // Record current position before stopping
      source.offsetTime = this.getPlaybackTime(path);
      if (source.sourceNode) {
        try { source.sourceNode.stop(); } catch { /* already stopped */ }
        source.sourceNode.disconnect();
        source.sourceNode = null;
      }
      source.playing = false;
      this.userPaused.add(path);
    }
  }

  public resumeAudio(path: string): void {
    const source = this.audioSources[path];
    if (source && !source.playing) {
      this.userPaused.delete(path);
      this.startSourceNode(path, source, source.offsetTime);
    }
  }

  public muteAudio(path: string): void {
    const source = this.audioSources[path];
    if (source) {
      source.gainNode.gain.value = 0;
    }
  }

  public unmuteAudio(path: string, volume: number = 1): void {
    const source = this.audioSources[path];
    if (source) {
      source.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  public updateLoopRegion(path: string, startTime?: number, endTime?: number): void {
    const source = this.audioSources[path];
    if (startTime != null || endTime != null) {
      this.audioLoopRegions[path] = { startTime: startTime ?? 0, endTime };
      if (source?.sourceNode) {
        source.sourceNode.loopStart = startTime ?? 0;
        source.sourceNode.loopEnd = endTime ?? source.duration;
        // Seek if currently outside the new region
        const currentTime = this.getPlaybackTime(path);
        const start = startTime ?? 0;
        const end = endTime ?? source.duration;
        if (currentTime < start || (end && currentTime > end)) {
          this.seekAudio(path, start);
        }
      }
    } else {
      delete this.audioLoopRegions[path];
      if (source?.sourceNode) {
        source.sourceNode.loopStart = 0;
        source.sourceNode.loopEnd = source.duration;
      }
    }
  }

  /** Get the current playback time for an audio source */
  private getPlaybackTime(path: string): number {
    const source = this.audioSources[path];
    if (!source) return 0;
    if (!source.playing || !this.audioContext) return source.offsetTime;

    const elapsed = this.audioContext.currentTime - source.startedAt;
    const region = this.audioLoopRegions[path];
    const regionStart = region?.startTime ?? 0;
    const regionEnd = region?.endTime ?? source.duration;
    const regionLen = regionEnd - regionStart;

    if (regionLen <= 0) return source.offsetTime + elapsed;
    return regionStart + ((source.offsetTime - regionStart + elapsed) % regionLen);
  }

  public seekAudio(path: string, time: number): void {
    const source = this.audioSources[path];
    if (!source) return;

    if (source.playing) {
      // Restart from new position
      this.startSourceNode(path, source, time);
    } else {
      source.offsetTime = time;
    }
  }

  public getAudioDuration(path: string): number {
    const source = this.audioSources[path];
    return source?.duration ?? 0;
  }

  public getAudioCurrentTime(path: string): number {
    return this.getPlaybackTime(path);
  }

  public resetAudio(path: string): void {
    const source = this.audioSources[path];
    if (source) {
      const region = this.audioLoopRegions[path];
      const time = region?.startTime ?? 0;
      this.seekAudio(path, time);
    }
  }

  public isAudioPaused(path: string): boolean {
    const source = this.audioSources[path];
    return source ? !source.playing : true;
  }

  public isAudioMuted(path: string): boolean {
    const source = this.audioSources[path];
    return source ? source.gainNode.gain.value === 0 : true;
  }

  public setAudioVolume(path: string, volume: number): void {
    const source = this.audioSources[path];
    if (source) {
      source.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  public setAllAudioVolumes(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const source of Object.values(this.audioSources)) {
      source.gainNode.gain.value = clamped;
    }
  }

  public muteAllAudio(): void {
    for (const source of Object.values(this.audioSources)) {
      source.gainNode.gain.value = 0;
    }
  }

  public unmuteAllAudio(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const source of Object.values(this.audioSources)) {
      source.gainNode.gain.value = clamped;
    }
  }

  public pauseAll(): void {
    for (const path of Object.keys(this.audioSources)) {
      const source = this.audioSources[path];
      if (source.playing) {
        source.offsetTime = this.getPlaybackTime(path);
        if (source.sourceNode) {
          try { source.sourceNode.stop(); } catch { /* already stopped */ }
          source.sourceNode.disconnect();
          source.sourceNode = null;
        }
        source.playing = false;
        console.log(`Paused audio: ${path}`);
      }
    }
  }

  public resumeAll(): void {
    for (const [path, source] of Object.entries(this.audioSources)) {
      // Skip audio still initializing
      if (this.initializing.has(path)) continue;
      if (!source.playing && !this.userPaused.has(path)) {
        this.startSourceNode(path, source, source.offsetTime);
        console.log(`Resumed audio: ${path}`);
      }
    }
  }

  public syncAllToTime(shaderTime: number): void {
    for (const [path, source] of Object.entries(this.audioSources)) {
      if (this.initializing.has(path)) continue;
      if (source.duration && isFinite(source.duration)) {
        const region = this.audioLoopRegions[path];
        const start = region?.startTime ?? 0;
        const end = region?.endTime ?? source.duration;
        const regionLength = end - start;
        const targetTime = regionLength > 0
          ? start + (shaderTime % regionLength)
          : shaderTime % source.duration;
        const currentTime = this.getPlaybackTime(path);
        if (Math.abs(currentTime - targetTime) > 0.05) {
          this.seekAudio(path, targetTime);
        }
      }
    }
  }

  public removeAudioSource(path: string): void {
    const source = this.audioSources[path];
    if (!source) return;

    if (source.sourceNode) {
      try { source.sourceNode.stop(); } catch { /* already stopped */ }
      source.sourceNode.disconnect();
    }
    source.analyser.disconnect();
    source.gainNode.disconnect();
    this.renderer.DestroyTexture(source.texture);
    delete this.audioSources[path];
    delete this.audioLoopRegions[path];
    this.initializing.delete(path);
    this.userPaused.delete(path);
  }

  // FFT data accessors for live preview
  public getAudioFFTData(path: string): Uint8Array | null {
    const source = this.audioSources[path];
    if (!source?.analyser) {
      return null;
    }
    source.analyser.getByteFrequencyData(source.freqData);
    return source.freqData;
  }

  // Called each frame to update audio textures
  public updateTextures(): void {
    for (const source of Object.values(this.audioSources)) {
      this.updateAudioTexture(source.analyser, source.texture, source.freqData, source.waveData);
    }
  }

  private updateAudioTexture(
    analyser: AnalyserNode,
    texture: PiTexture,
    freqData: Uint8Array,
    waveData: Uint8Array,
  ): void {
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(waveData);

    // Row 0: frequency data
    this.renderer.UpdateTexture(texture, 0, 0, this.textureWidth, 1, freqData);
    // Row 1: waveform data
    this.renderer.UpdateTexture(texture, 0, 1, this.textureWidth, 1, waveData);
  }

  public cleanup(): void {
    this.removeAutoResumeListeners();
    for (const path of Object.keys(this.audioSources)) {
      this.removeAudioSource(path);
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
