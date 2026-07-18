# Preserve Converted Video Duration

## Context

`VideoAudioConverter` copies a video's existing picture stream and re-encodes an unsupported audio stream. For the four-second test asset, the current MP3 conversion produces a four-second video stream and a `4.017007`-second audio stream. The extra audio duration ends in near-silence, so an unmuted looping video jumps from silence back into full-level audio.

The checked-in `video-audio-aac_vscode.mp4` is byte-for-byte identical to output from the current converter. The original AAC file has matching four-second video and audio streams. A diagnostic MP3 conversion constrained to four seconds also has matching streams and preserves full-level audio through the final ten milliseconds.

## Decision

Preserve the source video's duration during audio conversion. `VideoAudioConverter` will probe the primary video stream duration and, when it is finite and positive, pass that exact duration to FFmpeg as an output `-t` limit.

This is preferred over:

- `-shortest`, which produced a `3.997007`-second MP3 track and a larger sample discontinuity in the diagnostic conversion;
- runtime crossfading, which would mask a malformed converted timeline and require separate implementations for HTML video and decoded Web Audio playback;
- changing codecs, which would broaden compatibility work without addressing duration preservation directly.

## Data Flow

1. `convertAudio()` determines the output path and keeps the existing cache check.
2. Before conversion, it asks FFprobe for the primary video stream duration.
3. A finite, positive duration is passed into the existing FFmpeg argument builder.
4. Both the MP3 and Opus branches place `-t <duration>` before the output path.
5. If duration probing fails or returns an invalid value, conversion falls back to the current uncapped command rather than failing an otherwise usable conversion.

The converter remains the owner of this behavior. Rendering and media-control classes will not gain conversion-specific trimming or loop heuristics.

## Testing

Unit tests for `VideoAudioConverter` will cover:

- a valid video duration adds the exact `-t` argument to MP3 conversion;
- the duration cap is also retained by the Opus branch;
- missing, non-finite, zero, and negative durations omit the cap;
- an FFprobe duration failure does not prevent FFmpeg conversion;
- the existing output cache, codec detection, and FFmpeg failure behavior remain unchanged.

The implementation will be written test-first. Focused extension tests and compilation will run before regenerating the external test asset.

## Manual Verification

Regenerate `~/Projects/slang-multipass-test/assets/video-audio-aac_vscode.mp4` from the original AAC asset using the corrected conversion. Verify with FFprobe that the video stream, audio stream, and container are all exactly four seconds. Then load `video_audio_glsl.glsl`, unmute only the video channel, and confirm that its embedded audio loops without the previous silence-to-signal burst.

This slice targets the converted video-channel loop. Explicit play/pause transitions and decoded `type: "audio"` loop behavior remain separate runtime concerns and will only be changed if they still reproduce after the corrected asset is tested.
