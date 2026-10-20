import * as assert from "assert";
import proxyquire = require("proxyquire");
import type { Messenger } from "../../../app/transport/Messenger";

suite("GPU settings transport", () => {
  test("attaches validated defaults, broadcasts live changes, and disposes its listener", () => {
    let listener!: (event: { affectsConfiguration: (key: string) => boolean }) => void;
    let disposed = false;
    const values: Record<string, unknown> = { "gpuBackpressure.framesInFlight": 4, "gpuBackpressure.stallTimeoutMs": 500 };
    const { Messenger: Constructor } = proxyquire.noCallThru()("../../../app/transport/Messenger", {
      vscode: { workspace: {
        getConfiguration: () => ({ get: (key: string) => values[key] }),
        onDidChangeConfiguration: (fn: typeof listener) => {
          listener = fn; return { dispose: () => {
            disposed = true;
          } };
        },
      } },
      "./MessageHandler": { MessageHandler: class {} },
    }) as { Messenger: new (...args: unknown[]) => Messenger };
    const received: Record<string, unknown>[] = [];
    const messenger = new Constructor({}, { setShaderConfig: () => {} });
    messenger.addTransport({ send: message => received.push(message), close: () => {}, onMessage: () => {}, hasActiveClients: () => true });
    const message = { type: "shaderSource", config: null, path: "/shader.glsl" };
    messenger.send(message);
    assert.deepStrictEqual(received[0].gpuBackpressureDefaults, { framesInFlight: 4, stallTimeoutMs: 500 });
    assert.ok(!("gpuBackpressureDefaults" in message));
    listener({ affectsConfiguration: () => false });
    assert.strictEqual(received.length, 1);
    values["gpuBackpressure.framesInFlight"] = 0;
    listener({ affectsConfiguration: key => key === "shader-studio.gpuBackpressure" });
    assert.deepStrictEqual(received[1], { type: "gpuBackpressureSettings", defaults: { framesInFlight: 2, stallTimeoutMs: 500 } });
    messenger.close();
    assert.strictEqual(disposed, true);
  });
});
