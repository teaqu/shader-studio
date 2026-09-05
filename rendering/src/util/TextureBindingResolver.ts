import type { ConfigInput } from "@shader-studio/types";
import type { Buffers } from "../models";
import type { ResourceManager } from "../resources/ResourceManager";
import type { PiTexture } from "../types/piRenderer";
import type { SlotAssignment } from "./InputSlotAssigner";

/** Live key state to refresh the keyboard texture from before binding it. */
export interface KeyboardTextureState {
  held: Uint8Array;
  pressed: Uint8Array;
  toggled: Uint8Array;
}

export interface TextureBindingParams {
  inputs: Readonly<Record<string, ConfigInput>>;
  slotAssignments: SlotAssignment[];
  resourceManager: ResourceManager<PiTexture>;
  passBuffers: Buffers;
  /**
   * Null leaves the keyboard texture as it is. A paused frame binds the keys
   * it was rendered with rather than picking up ones pressed since.
   */
  keyboard: KeyboardTextureState | null;
}

/**
 * Resolves each input slot to the texture bound there.
 *
 * Rendering a pass and capturing variables out of it must agree here: a slot
 * resolved differently by one of them binds a resource the compiled shader
 * does not declare.
 */
export function resolveTextureBindings({
  inputs,
  slotAssignments,
  resourceManager,
  passBuffers,
  keyboard,
}: TextureBindingParams): (PiTexture | null)[] {
  const channelCount = Math.max(4, slotAssignments.length);
  const defaultTexture = resourceManager.getDefaultTexture();
  const textureBindings: (PiTexture | null)[] = new Array(channelCount).fill(defaultTexture);

  for (const { slot, key } of slotAssignments) {
    const input = inputs[key];
    if (!input) {
      textureBindings[slot] = defaultTexture;
      continue;
    }

    if (input.type === "texture" && input.path) {
      const imageCache = resourceManager.getImageTextureCache();
      textureBindings[slot] = imageCache[input.resolved_path || input.path] || imageCache[input.path] || defaultTexture;
    } else if (input.type === "cubemap" && input.path) {
      // No 2D fallback: the slot's uniform is a samplerCube, so the default
      // texture there is an invalid binding rather than a blank channel.
      textureBindings[slot] = resourceManager.getCubemapTexture(input.resolved_path || input.path)
        || resourceManager.getCubemapTexture(input.path);
    } else if (input.type === "keyboard") {
      if (keyboard) {
        resourceManager.updateKeyboardTexture(keyboard.held, keyboard.pressed, keyboard.toggled);
      }
      textureBindings[slot] = resourceManager.getKeyboardTexture() || defaultTexture;
    } else if (input.type === "buffer") {
      // Front holds the previous frame — a pass renders into back and the swap
      // happens after it — so a buffer reading its own source is safe here.
      textureBindings[slot] = passBuffers[input.source]?.front?.mTex0 || defaultTexture;
    } else if (input.type === "video" && input.path) {
      textureBindings[slot] = resourceManager.getVideoTexture(input.resolved_path || input.path)
        || resourceManager.getVideoTexture(input.path) || defaultTexture;
    } else if (input.type === "audio" && input.path) {
      textureBindings[slot] = resourceManager.getAudioTexture(input.resolved_path || input.path)
        || resourceManager.getAudioTexture(input.path) || defaultTexture;
    }
  }

  return textureBindings;
}
