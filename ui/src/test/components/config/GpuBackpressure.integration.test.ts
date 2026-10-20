import { render, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConfigPanel from "../../../lib/components/config/ConfigPanel.svelte";
import type { Transport } from "../../../lib/transport/MessageTransport";
import type { UpdateConfigMessage } from "@shader-studio/types";

describe("Rendering config tab", () => {
  it("persists an override without treating settings as a shader pass", async () => {
    const transport: Transport = { postMessage: vi.fn(), onMessage: vi.fn(), dispose: vi.fn(), getType: () => "vscode", isConnected: () => true };
    const onFileSelect = vi.fn();
    const view = render(ConfigPanel, { transport, onFileSelect, shaderPath: "/shader.glsl", config: { version: "1.0", passes: { Image: {} } } });
    await fireEvent.click(view.getByRole("button", { name: "Rendering" }));
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "Remove @rendering" })).not.toBeInTheDocument();
    await fireEvent.click(view.getByRole("checkbox", { name: /for frames in flight/ }));
    expect(transport.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "updateConfig", payload: expect.objectContaining({ config: expect.objectContaining({ gpuBackpressure: { framesInFlight: 2 } }) }),
    }));
    await fireEvent.input(view.getByLabelText("Frames in flight"), { target: { value: "1" } });
    expect(transport.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "updateConfig", payload: expect.objectContaining({ config: expect.objectContaining({ gpuBackpressure: { framesInFlight: 1 } }) }),
    }));
    await fireEvent.click(view.getByRole("checkbox", { name: /for frames in flight/ }));
    const message = vi.mocked(transport.postMessage).mock.calls.at(-1)![0] as UpdateConfigMessage;
    expect(message.payload.config).not.toHaveProperty("gpuBackpressure");
  });

  it("keeps a pass named Rendering distinct from rendering settings", async () => {
    const transport: Transport = { postMessage: vi.fn(), onMessage: vi.fn(), dispose: vi.fn(), getType: () => "vscode", isConnected: () => true };
    const view = render(ConfigPanel, { transport, config: { version: "1.0", passes: { Image: {}, Rendering: { path: "rendering.glsl" } } } });
    const tabs = view.getAllByRole("button", { name: /^Rendering/ });
    expect(tabs).toHaveLength(2);
    await fireEvent.click(tabs[1]);
    expect(view.getByRole("region", { name: "Rendering settings" })).toBeInTheDocument();
  });
});
