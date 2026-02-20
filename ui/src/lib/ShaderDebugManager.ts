import type { ShaderDebugState } from "./types/ShaderDebugState";
import { ShaderDebugger } from "@shader-studio/glsl-debug";

export class ShaderDebugManager {
  private state: ShaderDebugState = {
    isEnabled: false,
    currentLine: null,
    lineContent: null,
    filePath: null,
    isActive: false,
    functionContext: null,
    isLineLocked: false,
    isInlineRenderingEnabled: false,
  };

  private stateCallback: ((state: ShaderDebugState) => void) | null = null;

  public setStateCallback(callback: (state: ShaderDebugState) => void): void {
    this.stateCallback = callback;
  }

  public toggleEnabled(): void {
    this.state.isEnabled = !this.state.isEnabled;
    this.updateActiveState();
    this.notifyStateChange();
  }

  public updateDebugLine(line: number, lineContent: string, filePath: string): void {
    this.state.currentLine = line;
    this.state.lineContent = lineContent;
    this.state.filePath = filePath;
    this.updateActiveState();
    this.notifyStateChange();
  }

  public getState(): ShaderDebugState {
    return { ...this.state };
  }

  private updateActiveState(): void {
    this.state.isActive = this.state.isEnabled &&
                          this.state.currentLine !== null &&
                          this.state.lineContent !== null;
  }

  private notifyStateChange(): void {
    if (this.stateCallback) {
      this.stateCallback(this.getState());
    }
  }

  /**
   * Modifies shader code to execute up to the debug line.
   * Returns modified code or null if modification fails.
   */
  public modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
  ): string | null {
    if (!this.state.isActive || !this.state.lineContent) {
      return null;
    }

    return ShaderDebugger.modifyShaderForDebugging(originalCode, debugLine, this.state.lineContent);
  }
}
