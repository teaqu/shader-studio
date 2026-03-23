import * as vscode from "vscode";

export class LayoutStateStore {
  private static readonly LAYOUTS_KEY = "shader-studio.dockviewLayouts";
  private static readonly LEGACY_LAYOUT_KEY = "shader-studio.dockviewLayout";

  constructor(private readonly context: vscode.ExtensionContext) {}

  async save(layoutSlot: string | null, state: unknown): Promise<void> {
    if (!layoutSlot) return;

    const layouts = this.context.workspaceState.get<Record<string, unknown>>(LayoutStateStore.LAYOUTS_KEY, {});
    const nextLayouts = { ...layouts };

    if (state === null) {
      delete nextLayouts[layoutSlot];
    } else {
      nextLayouts[layoutSlot] = state;
    }

    await this.context.workspaceState.update(LayoutStateStore.LAYOUTS_KEY, nextLayouts);
  }

  load(layoutSlot: string | null): unknown {
    if (!layoutSlot) return null;

    const layouts = this.context.workspaceState.get<Record<string, unknown>>(LayoutStateStore.LAYOUTS_KEY, {});
    if (layoutSlot in layouts) {
      return layouts[layoutSlot];
    }

    if (layoutSlot === "vscode:1") {
      const legacyLayout = this.context.workspaceState.get(LayoutStateStore.LEGACY_LAYOUT_KEY, null);
      return legacyLayout
        ? { activeLayout: legacyLayout, panelSnapshots: {} }
        : null;
    }

    return null;
  }
}
