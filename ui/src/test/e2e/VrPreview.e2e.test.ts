import { expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import VrPreviewButton from "../components/fixtures/VrPaneHarness.svelte";
import { updateVrPreviewContext } from "../../lib/state/vrPreviewState.svelte";
import { createShaderCanvasHarness } from "../../../../rendering/src/test/e2e/ShaderCanvasHarness";

it("shows VR only for mainVR and switches the rendered entry through the preview button", async () => {
  const harness = createShaderCanvasHarness("glsl");
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(VrPreviewButton, { target });
  const image = "void mainImage(out vec4 c, in vec2 p) { c = vec4(1, 0, 0, 1); }";
  const vr = "void mainVR(out vec4 c, in vec2 p, in vec3 o, in vec3 d) { c = vec4(0, 1, 0, 1); }";
  try {
    await harness.compile({ image: image + vr });
    updateVrPreviewContext(harness.engine, "a.glsl");
    await tick();
    target.querySelector<HTMLButtonElement>('button[aria-label="VR"]')!.click();
    await tick();
    const button = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(button.checked).toBe(false);
    expect((await harness.renderAndReadPixels())[0]).toEqual([255, 0, 0, 255]);
    button.click();
    await tick();
    expect(button.checked).toBe(true);
    expect((await harness.renderAndReadPixels())[0]).toEqual([0, 255, 0, 255]);
    await expect(harness.compile({ image: "invalid shader source" })).rejects.toThrow();
    updateVrPreviewContext(harness.engine, "a.glsl", false);
    await tick();
    expect(button.checked).toBe(true);
    expect((await harness.renderAndReadPixels())[0]).toEqual([0, 255, 0, 255]);
    button.click();
    await tick();
    expect((await harness.renderAndReadPixels())[0]).toEqual([255, 0, 0, 255]);
    await harness.compile({ image, path: "b.glsl" });
    updateVrPreviewContext(harness.engine, "b.glsl");
    await tick();
    expect(target.querySelector('button[aria-label="VR"]')).toBeNull();
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  } finally {
    updateVrPreviewContext(null, "");
    await unmount(component);
    target.remove();
    harness.dispose();
  }
});
