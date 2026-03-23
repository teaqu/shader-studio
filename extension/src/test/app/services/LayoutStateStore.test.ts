import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { LayoutStateStore } from "../../../app/services/LayoutStateStore";

suite("LayoutStateStore Test Suite", () => {
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let store: LayoutStateStore;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockContext = {
      workspaceState: {
        get: sandbox.stub().returns(null),
        update: sandbox.stub().resolves(),
      },
    } as any;
    store = new LayoutStateStore(mockContext);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite("save", () => {
    test("persists layout to workspaceState", async () => {
      const layoutState = { activeLayout: { state: "some-layout-data" }, panelSnapshots: {} };
      (mockContext.workspaceState.get as sinon.SinonStub)
        .withArgs("shader-studio.dockviewLayouts", {})
        .returns({});

      await store.save("vscode:2", layoutState);

      assert.ok((mockContext.workspaceState.update as sinon.SinonStub).calledOnce);
      const call = (mockContext.workspaceState.update as sinon.SinonStub).firstCall;
      assert.strictEqual(call.args[0], "shader-studio.dockviewLayouts");
      assert.deepStrictEqual(call.args[1], {
        "vscode:2": layoutState,
      });
    });

    test("removes a saved layout when state is null", async () => {
      const existingLayouts = {
        "vscode:1": { activeLayout: { state: "first" }, panelSnapshots: {} },
        "vscode:2": { activeLayout: { state: "second" }, panelSnapshots: {} },
      };
      (mockContext.workspaceState.get as sinon.SinonStub)
        .withArgs("shader-studio.dockviewLayouts", {})
        .returns(existingLayouts);

      await store.save("vscode:1", null);

      const call = (mockContext.workspaceState.update as sinon.SinonStub).firstCall;
      assert.strictEqual(call.args[0], "shader-studio.dockviewLayouts");
      assert.deepStrictEqual(call.args[1], {
        "vscode:2": existingLayouts["vscode:2"],
      });
    });

    test("does nothing when no slot is provided", async () => {
      await store.save(null, { activeLayout: {}, panelSnapshots: {} });

      assert.ok((mockContext.workspaceState.update as sinon.SinonStub).notCalled);
    });
  });

  suite("load", () => {
    test("returns the saved layout for the requested slot", () => {
      const savedLayout = { activeLayout: { state: "saved-layout" }, panelSnapshots: {} };
      (mockContext.workspaceState.get as sinon.SinonStub)
        .withArgs("shader-studio.dockviewLayouts", {})
        .returns({ "vscode:2": savedLayout });

      const state = store.load("vscode:2");

      assert.deepStrictEqual(state, savedLayout);
    });

    test("returns null when no layout is saved", () => {
      (mockContext.workspaceState.get as sinon.SinonStub)
        .withArgs("shader-studio.dockviewLayouts", {})
        .returns({});

      const state = store.load("vscode:2");

      assert.strictEqual(state, null);
    });

    test("falls back to the legacy layout key for vscode:1", () => {
      const savedLayout = { state: "legacy-layout" };
      const migratedLayout = { activeLayout: savedLayout, panelSnapshots: {} };
      (mockContext.workspaceState.get as sinon.SinonStub)
        .withArgs("shader-studio.dockviewLayouts", {})
        .returns({})
        .withArgs("shader-studio.dockviewLayout", null)
        .returns(savedLayout);

      const state = store.load("vscode:1");

      assert.deepStrictEqual(state, migratedLayout);
    });

    test("returns null when no slot is provided", () => {
      const state = store.load(null);

      assert.strictEqual(state, null);
    });
  });
});
