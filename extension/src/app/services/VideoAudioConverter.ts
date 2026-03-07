import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Detects videos with unsupported audio codecs and offers conversion.
 *
 * VS Code webviews only support: Wav, Mp3, Ogg, Flac for audio.
 * H.264 video is supported, so we copy the video stream and only
 * re-encode the audio track to MP3.
 *
 * Converted files are placed alongside the original: video.mp4 -> video_vscode.mp4
 */
export class VideoAudioConverter {
  private ffmpegAvailable: boolean | null = null;

  private static readonly SUPPORTED_AUDIO_CODECS = new Set([
    "mp3",
    "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", // wav
    "vorbis",
    "opus",
    "flac",
  ]);

  /**
   * Check if a video has unsupported audio.
   * Returns the codec name if unsupported (e.g. "aac"), null if supported or no audio.
   */
  public async getUnsupportedAudioCodec(videoPath: string): Promise<string | null> {
    if (!(await this.ensureFfmpegAvailable())) {
      return null;
    }

    const codec = await this.getAudioCodec(videoPath);
    if (!codec) {
      return null;
    }

    if (VideoAudioConverter.SUPPORTED_AUDIO_CODECS.has(codec)) {
      return null;
    }

    return codec;
  }

  /**
   * Convert video to have MP3 audio. Returns path to new file.
   * Creates copy alongside original: video.mp4 -> video_vscode.mp4
   * Identical video stream, only audio re-encoded.
   *
   * If output already exists and is newer than source, skips conversion.
   */
  public async convertAudio(videoPath: string): Promise<string> {
    const outputPath = this.getOutputPath(videoPath);

    // Skip if output already exists and is newer than source
    if (fs.existsSync(outputPath)) {
      const srcStat = fs.statSync(videoPath);
      const outStat = fs.statSync(outputPath);
      if (outStat.mtimeMs > srcStat.mtimeMs) {
        console.log(`[VideoAudioConverter] Using existing conversion: ${path.basename(outputPath)}`);
        return outputPath;
      }
    }

    console.log(`[VideoAudioConverter] Converting ${path.basename(videoPath)} audio to MP3...`);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-c:v", "copy",
      "-c:a", "libmp3lame",
      "-q:a", "2",
      outputPath,
    ], { timeout: 120_000 });

    console.log(`[VideoAudioConverter] Created ${path.basename(outputPath)}`);
    return outputPath;
  }

  private async ensureFfmpegAvailable(): Promise<boolean> {
    if (this.ffmpegAvailable === null) {
      this.ffmpegAvailable = await this.checkFfmpegAvailable();
    }
    return this.ffmpegAvailable;
  }

  private async checkFfmpegAvailable(): Promise<boolean> {
    try {
      await execFileAsync("ffmpeg", ["-version"], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  private async getAudioCodec(videoPath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name",
        "-of", "csv=p=0",
        videoPath,
      ], { timeout: 10_000 });

      const codec = stdout.trim();
      return codec || null;
    } catch {
      return null;
    }
  }

  private getOutputPath(videoPath: string): string {
    const ext = path.extname(videoPath);
    const base = path.basename(videoPath, ext);
    const dir = path.dirname(videoPath);
    return path.join(dir, `${base}_vscode${ext}`);
  }
}
