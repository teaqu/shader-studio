import type { ShaderDebugState, NormalizeMode } from "./types/ShaderDebugState";
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
    normalizeMode: 'off' as NormalizeMode,
    isStepEnabled: false,
    stepEdge: 0.5,
    debugError: null,
  };

  private stateCallback: ((state: ShaderDebugState) => void) | null = null;
  private customParameters: Map<number, string> = new Map();
  private loopMaxIterations: Map<number, number> = new Map();
  private lastOriginalCode: string | null = null;
  private lockedFilePath: string | null = null;
  private lastFunctionName: string | null = null;

  public setStateCallback(callback: (state: ShaderDebugState) => void): void {
    this.stateCallback = callback;
  }

  public toggleEnabled(): void {
    this.state.isEnabled = !this.state.isEnabled;
    if (!this.state.isEnabled) {
      this.state.isLineLocked = false;
      this.lockedFilePath = null;
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
    this.state.debugError = null;
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

  public cycleNormalizeMode(): void {
    const modes: NormalizeMode[] = ['off', 'soft', 'abs'];
    const currentIndex = modes.indexOf(this.state.normalizeMode);
    this.state.normalizeMode = modes[(currentIndex + 1) % modes.length];
    this.notifyStateChange();
  }

  public toggleStep(): void {
    this.state.isStepEnabled = !this.state.isStepEnabled;
    this.notifyStateChange();
  }

  public setStepEdge(edge: number): void {
    this.state.stepEdge = edge;
    this.notifyStateChange();
  }

  public setDebugError(error: string | null): void {
    this.state.debugError = error;
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
   * Applies normalize/step post-processing to the full shader output.
   * Used when no line is selected or inline rendering is off.
   */
  public applyFullShaderPostProcessing(originalCode: string): string | null {
    const stepEdge = this.state.isStepEnabled ? this.state.stepEdge : null;
    if (this.state.normalizeMode === 'off' && stepEdge === null) {
      return null;
    }
    return ShaderDebugger.applyFullShaderPostProcessing(
      originalCode,
      this.state.normalizeMode,
      stepEdge,
    );
  }

  /**
   * Modifies shader code to execute up to the debug line.
   * Returns modified code or null if modification fails or inline rendering is off.
   * Falls back to full-shader post-processing when inline is off but normalize/step active.
   */
  public modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
  ): string | null {
    if (!this.state.isActive || !this.state.lineContent) {
      return null;
    }

    if (!this.state.isInlineRenderingEnabled) {
      return this.applyFullShaderPostProcessing(originalCode);
    }

    const result = ShaderDebugger.modifyShaderForDebugging(
      originalCode,
      debugLine,
      this.state.lineContent,
      this.loopMaxIterations,
      this.customParameters,
      this.state.normalizeMode,
      this.state.isStepEnabled ? this.state.stepEdge : null,
    );

    if (result === null) {
      this.state.debugError = 'No debuggable variable on this line';
      this.notifyStateChange();
    } else {
      this.state.debugError = null;
    }

    return result;
  }
}
