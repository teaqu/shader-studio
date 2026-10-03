import { SystemAudioCapture } from "./SystemAudioCapture";
import type { TextureBackend, TextureFilter, TextureWrap } from "./TextureBackend";

export type LiveInputType = "webcam" | "microphone" | "system-audio";

export interface LiveInputPreview {
  unsupportedReason?: string;
  deviceId?: string;
  ready?: boolean;
  video?: HTMLVideoElement;
  frequency?: Uint8Array;
  waveform?: Uint8Array;
}

export interface LiveInputOptions {
  deviceId?: string;
  filter?: TextureFilter;
  wrap?: TextureWrap;
  vflip?: boolean;
}

export interface LiveInputLoadResult<T> {
  texture: T | null;
  warning?: string;
}

interface LiveInput<T> {
  stream: MediaStream;
  texture: T;
  video?: HTMLVideoElement;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  gain?: GainNode;
  frequency?: Uint8Array;
  waveform?: Uint8Array;
  onEnded?: () => void;
  releaseCapture?: () => void;
}

/**
 * Owns the browser-only capture resources used by live shader channels. A
 * single stream is shared by every channel of a given type, which avoids
 * repeated permission prompts and releases hardware deterministically.
 */
export class LiveInputTextureManager<T> {
  private readonly inputs = new Map<LiveInputType, LiveInput<T>>();
  private readonly pending = new Map<LiveInputType, Promise<LiveInputLoadResult<T>>>();
  private audioContext: AudioContext | null = null;
  private resumeListener: (() => void) | null = null;
  private readonly videoWaiters = new Set<() => void>();
  private readonly provisionalCaptures = new Map<MediaStream, HTMLVideoElement | undefined>();
  private readonly stoppedStreams = new WeakSet<MediaStream>();
  private disposed = false;
  private microphoneGeneration = 0;

  constructor(private readonly backend: TextureBackend<T>, private readonly systemAudio = new SystemAudioCapture()) {}

  public async load(type: LiveInputType, options: LiveInputOptions = {}): Promise<LiveInputLoadResult<T>> {
    const cached = this.inputs.get(type);
    if (cached) {
      return { texture: cached.texture };
    }
    const existing = this.pending.get(type);
    if (existing) {
      return existing;
    }

    const request = this.loadFresh(type, options);
    this.pending.set(type, request);
    try {
      return await request;
    } finally {
      if (this.pending.get(type) === request) {
        this.pending.delete(type);
      }
    }
  }

  public async startAudioInput(deviceId = "default"): Promise<string | undefined> {
    this.stopAudioInput();
    const result = await this.load("microphone", { deviceId });
    return result.warning;
  }

  public stopAudioInput(): void {
    ++this.microphoneGeneration;
    this.pending.delete("microphone");
    const input = this.inputs.get("microphone");
    if (input) {
      this.release("microphone", input);
    }
  }

  public async startSystemAudio(deviceId?: string): Promise<string | undefined> {
    if (this.disposed) {
      return "Shader is no longer active. Reopen its System Audio channel.";
    }
    const warning = await this.systemAudio.start(deviceId);
    if (warning) {
      return warning;
    }
    if (this.disposed) {
      this.systemAudio.stop();
      return "Sharing was stopped because the shader changed.";
    }
    const result = await this.load("system-audio");
    return result.warning;
  }

  public stopSystemAudio(): void {
    this.systemAudio.stop();
  }

  public getTexture(type: LiveInputType): T | null {
    return this.inputs.get(type)?.texture ?? null;
  }

  public getVideoElement(): HTMLVideoElement | undefined {
    return this.inputs.get("webcam")?.video;
  }

  public getAudioState(type: LiveInputType = "microphone"): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    if (!this.inputs.has(type)) {
      return null;
    }
    // A capture stream has no finite media duration and is intentionally never
    // connected audibly. Its context clock is the useful channel clock.
    return { paused: false, muted: true, currentTime: this.audioContext?.currentTime ?? 0, duration: 0 };
  }

  public updateTextures(): void {
    const webcam = this.inputs.get("webcam");
    if (webcam?.video && webcam.video.videoWidth > 0 && webcam.video.videoHeight > 0) {
      this.backend.updateTextureFromImage(webcam.texture, webcam.video);
    }
    for (const microphone of this.inputs.values()) {
      if (microphone?.analyser && microphone.frequency && microphone.waveform) {
        try {
          microphone.analyser.getByteFrequencyData(microphone.frequency);
          microphone.analyser.getByteTimeDomainData(microphone.waveform);
          this.backend.updateTexture(microphone.texture, 0, 0, 512, 1, microphone.frequency);
          this.backend.updateTexture(microphone.texture, 0, 1, 512, 1, microphone.waveform);
        } catch (error) {
          console.warn("Live audio texture update failed:", error);
        }
      }
    }
  }

  /** Read-only view of existing capture; never acquires a device. */
  public getPreview(type: LiveInputType): LiveInputPreview | null {
    const input = this.inputs.get(type);
    return input ? { video: input.video, frequency: input.frequency, waveform: input.waveform } : null;
  }

  public getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 0;
  }

  public cleanup(): void {
    this.disposed = true;
    for (const cancel of this.videoWaiters) {
      cancel();
    }
    this.videoWaiters.clear();
    this.removeResumeListener();
    for (const [stream, video] of this.provisionalCaptures) {
      this.stopStream(stream);
      video?.pause();
      if (video) {
        video.srcObject = null;
        video.remove();
      }
    }
    this.provisionalCaptures.clear();
    for (const [type, input] of this.inputs) {
      this.release(type, input);
    }
    this.inputs.clear();
    const context = this.audioContext;
    this.audioContext = null;
    void context?.close().catch(() => undefined);
  }

  private async loadFresh(type: LiveInputType, options: LiveInputOptions): Promise<LiveInputLoadResult<T>> {
    if (this.disposed) {
      return { texture: null, warning: "Live input is no longer available." };
    }
    if (type === "system-audio") {
      const lease = this.systemAudio.acquire(() => {
        const input = this.inputs.get("system-audio");
        if (input) {
          this.release("system-audio", input);
        }
      });
      if (!lease) {
        return { texture: null, warning: "Open the System Audio channel and click Start sharing to choose tab/system audio or a routed audio device." };
      }
      return this.installMicrophone(lease.stream, {}, "system-audio", lease.release);
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return { texture: null, warning: "Live capture needs a secure localhost or HTTPS page. Open Shader Studio in a browser if VS Code does not expose microphone or webcam access." };
    }

    const microphoneGeneration = this.microphoneGeneration;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(type === "webcam" ? { video: true, audio: false } : { audio: options.deviceId && options.deviceId !== "default" ? { deviceId: { exact: options.deviceId } } : true, video: false });
    } catch (error) {
      return { texture: null, warning: this.captureWarning(type, error) };
    }
    if (this.disposed || type === "microphone" && microphoneGeneration !== this.microphoneGeneration) {
      this.stopStream(stream);
      return { texture: null, warning: "Live input was stopped before permission completed." };
    }

    this.provisionalCaptures.set(stream, undefined);
    try {
      return type === "webcam" ? await this.installWebcam(stream, options) : this.installMicrophone(stream, options);
    } finally {
      this.provisionalCaptures.delete(stream);
    }
  }

  private async installWebcam(stream: MediaStream, options: LiveInputOptions): Promise<LiveInputLoadResult<T>> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    this.provisionalCaptures.set(stream, video);
    video.style.display = "none";
    document.body.appendChild(video);
    try {
      await video.play();
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        await this.waitForVideoFrame(video);
      }
      if (this.disposed) {
        video.pause();
        video.srcObject = null;
        video.remove();
        this.stopStream(stream);
        return { texture: null, warning: "Webcam capture was stopped before it became ready." };
      }
      const texture = this.backend.createTextureFromImage(video, {
        type: "2d", format: "rgba8", filter: options.filter ?? "linear", wrap: options.wrap ?? "clamp", vflip: options.vflip ?? true,
      });
      if (!texture) {
        throw new Error("GPU texture allocation failed");
      }
      if (this.disposed) {
        this.backend.destroyTexture(texture);
        throw new Error("capture was stopped during texture creation");
      }
      const input: LiveInput<T> = { stream, texture, video };
      input.onEnded = () => this.release("webcam", input);
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", input.onEnded);
      }
      this.inputs.set("webcam", input);
      return { texture };
    } catch (error) {
      video.pause();
      video.srcObject = null;
      video.remove();
      this.stopStream(stream);
      return { texture: null, warning: `Webcam is unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private installMicrophone(stream: MediaStream, options: LiveInputOptions, type: LiveInputType = "microphone", releaseCapture?: () => void): LiveInputLoadResult<T> {
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let gain: GainNode | undefined;
    let texture: T | null = null;
    try {
      const context = this.ensureAudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      gain = context.createGain();
      gain.gain.value = 0;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      texture = this.backend.createTexture({
        type: "2d", width: 512, height: 2, format: "r8", filter: options.filter ?? "linear", wrap: options.wrap ?? "clamp", data: null,
      });
      if (!texture) {
        throw new Error("GPU texture allocation failed");
      }
      if (this.disposed) {
        this.backend.destroyTexture(texture);
        gain.disconnect();
        analyser.disconnect();
        source.disconnect();
        if (releaseCapture) {
          releaseCapture();
        } else {
          this.stopStream(stream);
        }
        this.closeUnusedAudioContext();
        return { texture: null, warning: "Microphone capture was stopped before it became ready." };
      }
      const input: LiveInput<T> = {
        stream, texture, source, analyser, gain, releaseCapture,
        frequency: new Uint8Array(512), waveform: new Uint8Array(512),
      };
      input.onEnded = () => this.release(type, input);
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", input.onEnded);
      }
      this.inputs.set(type, input);
      return { texture };
    } catch (error) {
      if (texture) {
        this.backend.destroyTexture(texture);
      }
      gain?.disconnect();
      analyser?.disconnect();
      source?.disconnect();
      if (releaseCapture) {
        releaseCapture();
      } else {
        this.stopStream(stream);
      }
      this.closeUnusedAudioContext();
      return { texture: null, warning: `${type === "system-audio" ? "System audio" : "Microphone"} is unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      const resume = () => {
        void this.resumeAudioContext();
      };
      this.resumeListener = resume;
      document.addEventListener("pointerdown", resume);
      document.addEventListener("keydown", resume);
      void this.resumeAudioContext();
    }
    return this.audioContext;
  }

  private removeResumeListener(): void {
    if (this.resumeListener) {
      document.removeEventListener("pointerdown", this.resumeListener);
      document.removeEventListener("keydown", this.resumeListener);
      this.resumeListener = null;
    }
  }

  private async resumeAudioContext(): Promise<void> {
    const context = this.audioContext;
    if (!context) {
      return;
    }
    try {
      if (context.state !== "running") {
        await context.resume();
      }
      if (context.state === "running") {
        this.removeResumeListener();
      }
    } catch {
      // The next pointer or key gesture will retry.
    }
  }

  private closeUnusedAudioContext(): void {
    if (this.audioContext && !this.inputs.has("microphone") && !this.inputs.has("system-audio")) {
      const context = this.audioContext;
      this.audioContext = null;
      this.removeResumeListener();
      void context.close().catch(() => undefined);
    }
  }

  private release(type: LiveInputType, input: LiveInput<T>): void {
    if (this.inputs.get(type) !== input) {
      return;
    }
    if (this.inputs.get(type) === input) {
      this.inputs.delete(type);
    }
    for (const track of input.stream.getTracks()) {
      if (input.onEnded) {
        track.removeEventListener("ended", input.onEnded);
      }
    }
    if (input.releaseCapture) {
      input.releaseCapture();
    } else {
      this.stopStream(input.stream);
    }
    input.video?.pause();
    if (input.video) {
      input.video.srcObject = null;
      input.video.remove();
    }
    input.gain?.disconnect();
    input.analyser?.disconnect();
    input.source?.disconnect();
    this.backend.destroyTexture(input.texture);
    this.closeUnusedAudioContext();
  }

  private waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const remove = () => {
        this.videoWaiters.delete(cancel);
        video.removeEventListener("loadeddata", finish);
        video.removeEventListener("error", fail);
      };
      const finish = () => {
        remove(); resolve();
      };
      const fail = () => {
        remove(); reject(new Error("camera did not provide a video frame"));
      };
      const cancel = () => {
        remove(); resolve();
      };
      this.videoWaiters.add(cancel);
      video.addEventListener("loadeddata", finish, { once: true });
      video.addEventListener("error", fail, { once: true });
    });
  }

  private stopStream(stream: MediaStream): void {
    if (this.stoppedStreams.has(stream)) {
      return;
    }
    this.stoppedStreams.add(stream);
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }

  private captureWarning(type: LiveInputType, error: unknown): string {
    const name = error instanceof DOMException ? error.name : "";
    const label = type === "webcam" ? "Webcam" : "Microphone";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return `${label} permission was denied. Allow access in your browser or VS Code settings, then reload the shader.`;
    }
    if (name === "NotFoundError") {
      return `No ${type === "webcam" ? "camera" : "microphone"} was found.`;
    }
    return `${label} capture could not start. Check that the device is available and not being used by another application.`;
  }
}
