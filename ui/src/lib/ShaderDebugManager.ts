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
    isInlineRenderingEnabled: true,
  };

  private stateCallback: ((state: ShaderDebugState) => void) | null = null;
  private onDisableCallback: (() => void) | null = null;
  private customParameters: Map<number, string> = new Map();
  private loopMaxIterations: Map<number, number> = new Map();
  private lastOriginalCode: string | null = null;
  private lockedFilePath: string | null = null;
  private lastFunctionName: string | null = null;

  public setStateCallback(callback: (state: ShaderDebugState) => void): void {
    this.stateCallback = callback;
  }

  public setOnDisableCallback(callback: () => void): void {
    this.onDisableCallback = callback;
  }

  public toggleEnabled(): void {
    this.state.isEnabled = !this.state.isEnabled;
    if (this.state.isEnabled) {
      this.state.isInlineRenderingEnabled = true;
    } else {
      this.state.isInlineRenderingEnabled = false;
      this.state.isLineLocked = false;
      this.lockedFilePath = null;
      this.onDisableCallback?.();
    }
    this.updateActiveState();
    this.notifyStateChange();
  }

  public updateDebugLine(line: number, lineContent: string, filePath: string): void {
    // Line lock logic
    if (this.state.isLineLocked) {
      if (filePath === this.lockedFilePath) {
        // Same file, locked — ignore the update
        return;
      }
      // Different file — auto-unlock
      this.state.isLineLocked = false;
      this.lockedFilePath = null;
    }

    this.state.currentLine = line;
    this.state.lineContent = lineContent;
    this.state.filePath = filePath;
    this.updateActiveState();
    this.updateFunctionContext();
    this.notifyStateChange();
  }

  public getState(): ShaderDebugState {
    return { ...this.state };
  }

  public setOriginalCode(code: string): void {
    this.lastOriginalCode = code;
  }

  public setCustomParameter(index: number, value: string | null): void {
    if (value === null) {
      this.customParameters.delete(index);
    } else {
      this.customParameters.set(index, value);
    }
  }

  public setLoopMaxIterations(loopIndex: number, maxIter: number | null): void {
    if (maxIter === null) {
      this.loopMaxIterations.delete(loopIndex);
    } else {
      this.loopMaxIterations.set(loopIndex, maxIter);
    }
  }

  public getCustomParameters(): Map<number, string> {
    return new Map(this.customParameters);
  }

  public getLoopMaxIterations(): Map<number, number> {
    return new Map(this.loopMaxIterations);
  }

  public toggleLineLock(): void {
    this.state.isLineLocked = !this.state.isLineLocked;
    if (this.state.isLineLocked) {
      this.lockedFilePath = this.state.filePath;
    } else {
      this.lockedFilePath = null;
    }
    this.notifyStateChange();
  }

  public toggleInlineRendering(): void {
    this.state.isInlineRenderingEnabled = !this.state.isInlineRenderingEnabled;
    this.notifyStateChange();
  }

  private updateActiveState(): void {
    this.state.isActive = this.state.isEnabled &&
                          this.state.currentLine !== null &&
                          this.state.lineContent !== null;
  }

  private updateFunctionContext(): void {
    if (!this.lastOriginalCode || this.state.currentLine === null) {
      this.state.functionContext = null;
      return;
    }

    const context = ShaderDebugger.extractFunctionContext(
      this.lastOriginalCode,
      this.state.currentLine,
    );

    // Clear custom params when switching functions
    const newFunctionName = context?.functionName ?? null;
    if (newFunctionName !== this.lastFunctionName) {
      this.customParameters.clear();
      this.loopMaxIterations.clear();
      this.lastFunctionName = newFunctionName;
    }

    this.state.functionContext = context;
  }

  private notifyStateChange(): void {
    if (this.stateCallback) {
      this.stateCallback(this.getState());
    }
  }

  /**
   * Modifies shader code to execute up to the debug line.
   * Returns modified code or null if modification fails or inline rendering is off.
   */
  public modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
  ): string | null {
    if (!this.state.isActive || !this.state.lineContent) {
      return null;
    }

    if (!this.state.isInlineRenderingEnabled) {
      return null;
    }

    return ShaderDebugger.modifyShaderForDebugging(
      originalCode,
      debugLine,
      this.state.lineContent,
      this.loopMaxIterations,
      this.customParameters,
    );
  }
}
