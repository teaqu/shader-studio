import { afterEach, beforeEach, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import VrPreviewButton from "../components/fixtures/VrPaneHarness.svelte";
import { updateVrPreviewContext, updateVrNavigationSettings, setVrPanelVisible } from "../../lib/state/vrPreviewState.svelte";
import { createShaderCanvasHarness } from "../../../../rendering/src/test/e2e/ShaderCanvasHarness";

beforeEach(() => setVrPanelVisible(false));
afterEach(() => setVrPanelVisible(false));

it("keeps the VR pane accessible without mainVR and switches compatible previews", async () => {
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
    const paneButton = target.querySelector<HTMLButtonElement>('button[aria-label="VR"]')!;
    expect(paneButton).not.toBeNull();
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    paneButton.click();
    await tick();
    expect(target.querySelector('[aria-label="VR settings"]')).toBeNull();
    paneButton.click();
    await tick();
    expect(target.querySelector('[aria-label="VR settings"]')!.textContent).toContain('Open a fullscreen GLSL shader');
  } finally {
    updateVrPreviewContext(null, "");
    await unmount(component);
    target.remove();
    harness.dispose();
  }
});


it("applies shared speed sliders to desktop movement and keyboard look with headset navigation off", async () => {
  const harness = createShaderCanvasHarness("glsl");
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(VrPreviewButton, { target });
  const key = (type: string, code: number) => {
    const event = new KeyboardEvent(type);
    Object.defineProperty(event, 'keyCode', { value: code });
    window.dispatchEvent(event);
  };
  const setSpeed = async (label: string, value: number) => {
    const input = target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(input.disabled).toBe(false);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
  };
  const advance = async () => {
    let pixel: number[] = [];
    for (let i = 0; i < 4; i++) {
      pixel = (await harness.renderAndReadPixels())[0];
    }
    return pixel;
  };
  try {
    await harness.compile({ image: `
      void mainImage(out vec4 c, in vec2 p) { c = vec4(0,0,0,1); }
      void mainVR(out vec4 c, in vec2 p, in vec3 o, in vec3 d) { c = vec4(d.x * 0.3 + 0.5, clamp(-o.z * 0.5, 0.0, 1.0), 0, 1); }
    ` });
    updateVrNavigationSettings({ movement: false, movementSpeed: 2, turnSpeed: 90 });
    updateVrPreviewContext(harness.engine, 'shared-speeds.glsl');
    await tick();
    target.querySelector<HTMLButtonElement>('button[aria-label="VR"]')!.click();
    await tick();
    target.querySelector<HTMLInputElement>('input[role="switch"]')!.click();
    await tick();
    const start = (await harness.renderAndReadPixels())[0];
    key('keydown', 87);
    const slowMove = await advance();
    await setSpeed('Movement speed (m/s)', 4);
    const fastMove = await advance();
    key('keyup', 87);
    expect(slowMove[1] - start[1]).toBeGreaterThan(0);
    expect(fastMove[1] - slowMove[1]).toBeGreaterThan((slowMove[1] - start[1]) * 1.5);
    await setSpeed('Turn speed (degrees/s)', 45);
    key('keydown', 39);
    const slowTurn = await advance();
    await setSpeed('Turn speed (degrees/s)', 180);
    const fastTurn = await advance();
    key('keyup', 39);
    expect(slowTurn[0] - fastMove[0]).toBeGreaterThan(0);
    expect(fastTurn[0] - slowTurn[0]).toBeGreaterThan((slowTurn[0] - fastMove[0]) * 2);
  } finally {
    key('keyup', 87);
    key('keyup', 39);
    updateVrNavigationSettings({ movement: false, movementSpeed: 2, turnSpeed: 90 });
    updateVrPreviewContext(null, '');
    await unmount(component);
    target.remove();
    harness.dispose();
  }
});
