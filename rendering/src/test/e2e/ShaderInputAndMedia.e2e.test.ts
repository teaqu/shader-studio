import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import {
  createShaderCanvasHarness,
  type Pixel,
  type ShaderLanguage,
  type ShaderProgram,
} from "./ShaderCanvasHarness";

const videoPath = new URL("../fixtures/shader-corpus/assets/video-channel-test.mp4", import.meta.url).href;
const audioPath = new URL("../fixtures/shader-corpus/assets/audio-channel-test.wav", import.meta.url).href;

const inputPrograms: Record<ShaderLanguage, ShaderProgram> = {
  glsl: {
    image: `float keyRow(float row) {
      return texture(iChannel0, vec2((65.0 + 0.5) / 256.0, (row + 0.5) / 3.0)).r;
    }
    void mainImage(out vec4 color, in vec2 fragCoord) {
      vec3 keyState = vec3(keyRow(0.0), keyRow(1.0), keyRow(2.0));
      if (fragCoord.x < iResolution.x * 0.5) {
        color = vec4(keyState, 1.0);
      } else {
        color = vec4(iMouse.z > 0.0 ? 1.0 : 0.0, iMouse.xy / iResolution.xy, 1.0);
      }
    }`,
    config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "keyboard" } } } } },
  },
  slang: {
    image: `float keyRow(float row) {
      return sampleIChannel0(float2((65.0 + 0.5) / 256.0, (row + 0.5) / 3.0)).r;
    }
    float4 mainImage(float2 fragCoord) {
      float3 keyState = float3(keyRow(0.0), keyRow(1.0), keyRow(2.0));
      if (fragCoord.x < iResolution.x * 0.5) {
        return float4(keyState, 1.0);
      }
      return float4(iMouse.z > 0.0 ? 1.0 : 0.0, iMouse.xy / iResolution.xy, 1.0);
    }`,
    config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "keyboard" } } } } },
  },
};

const mediaPrograms: Record<ShaderLanguage, string> = {
  glsl: `void mainImage(out vec4 color, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    color = vec4(texture(iChannel0, uv).rgb, 1.0);
  }`,
  slang: `float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    return float4(sampleIChannel0(uv).rgb, 1.0);
  }`,
};

const mediaConfig: ShaderConfig = {
  version: "1",
  passes: {
    Image: {
      inputs: {
        iChannel0: {
          type: "video",
          path: videoPath,
          resolved_path: videoPath,
          muted: true,
          vflip: true,
        },
        iChannel1: {
          type: "audio",
          path: audioPath,
          resolved_path: audioPath,
          muted: true,
        },
      },
    },
  },
};

function dispatchKey(type: "keydown" | "keyup"): void {
  const event = new KeyboardEvent(type, { key: "a", code: "KeyA" });
  Object.defineProperty(event, "keyCode", { value: 65 });
  window.dispatchEvent(event);
}

function dispatchPointer(canvas: HTMLCanvasElement, type: "pointerdown" | "pointerup"): void {
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: 1,
    clientX: rect.left + rect.width * 0.75,
    clientY: rect.top + rect.height * 0.25,
  }));
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeout = 3_000,
): Promise<void> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function interactionPixels(key: Pixel, mouse: Pixel): Pixel[] {
  return [key, mouse, key, mouse];
}

describe.each(["glsl", "slang"] as const)("%s input and media progression", (language) => {
  it("propagates held, pressed, toggled, released, and pointer state", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness(language);
    harness.canvas.setPointerCapture = () => {};
    harness.canvas.releasePointerCapture = () => {};
    try {
      await harness.compile(inputPrograms[language]);
      dispatchKey("keydown");
      dispatchPointer(harness.canvas, "pointerdown");
      expect(await harness.renderAndReadPixels()).toEqual(interactionPixels(
        [255, 255, 255, 255],
        [255, 128, 128, 255],
      ));
      expect(await harness.renderAndReadPixels()).toEqual(interactionPixels(
        [255, 0, 255, 255],
        [255, 128, 128, 255],
      ));
      dispatchKey("keyup");
      dispatchPointer(harness.canvas, "pointerup");
      expect(await harness.renderAndReadPixels()).toEqual(interactionPixels(
        [0, 0, 255, 255],
        [0, 128, 128, 255],
      ));
    } finally {
      dispatchKey("keyup");
      harness.dispose();
    }
  });

  it("advances decoded video and audio playback", { timeout: 30_000 }, async () => {
    const harness = createShaderCanvasHarness(language);
    harness.resize(64, 64);
    try {
      await harness.compile({ image: mediaPrograms[language], config: mediaConfig });
      const initialVideo = harness.engine.getVideoState(videoPath);
      const initialAudio = harness.engine.getAudioState(audioPath);
      expect(initialVideo?.duration).toBeGreaterThan(0);
      expect(initialAudio?.duration).toBeGreaterThan(0);
      const initialRegion = await harness.renderAndReadRegion();

      harness.engine.controlVideo(videoPath, "play");
      await waitFor(
        () => (harness.engine.getVideoState(videoPath)?.currentTime ?? 0) > (initialVideo?.currentTime ?? 0) + 0.05,
        `${language} video did not advance`,
      );

      harness.engine.controlVideo(videoPath, "pause");
      const audioTarget = Math.min(0.5, initialAudio!.duration / 2);
      harness.engine.seekAudio(audioPath, audioTarget);
      expect(harness.engine.getAudioState(audioPath)?.currentTime).toBeCloseTo(audioTarget, 2);
      harness.engine.controlAudio(audioPath, "play");
      expect(harness.engine.getAudioState(audioPath)?.paused).toBe(false);
      harness.engine.controlAudio(audioPath, "pause");
      const advancedVideo = harness.engine.getVideoState(videoPath);
      const advancedAudio = harness.engine.getAudioState(audioPath);
      expect(advancedVideo).toMatchObject({ paused: true, muted: true });
      expect(advancedAudio).toMatchObject({ paused: true, muted: true });
      expect(advancedVideo!.currentTime).toBeGreaterThan(initialVideo!.currentTime + 0.05);
      expect(advancedAudio!.currentTime).toBeGreaterThan(initialAudio!.currentTime + 0.05);
      expect(await harness.renderAndReadRegion()).not.toEqual(initialRegion);
    } finally {
      harness.dispose();
    }
  });
});
