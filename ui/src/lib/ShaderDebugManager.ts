import type { DebugFunctionContext, ShaderDebugState, NormalizeMode } from "./types/ShaderDebugState";
import { ShaderDebugger } from "@shader-studio/glsl-debug";
import type { CapturedVariable } from "./VariableCaptureManager";
import type { ShaderConfig, ConfigInput } from "@shader-studio/types";

export interface DebugTarget {
  passName: string;
  code: string;
  config: ShaderConfig | null;
  inputConfig?: Record<string, ConfigInput>;
}

interface VariablePreviewState {
  varName: string;
  varType: string;
  debugLine: number;
  activeBufferName: string;
  filePath: string | null;
  debugError: string | null;
  debugNotice?: string | null;
}

export interface VariablePreviewRequest {
  varName: string;
  varType: string;
  debugLine: number;
  activeBufferName: string;
  filePath: string | null;
}

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
    debugNotice: null,
    isVariableInspectorEnabled: false,
    capturedVariables: [],
    activeBufferName: 'Image',
  };

  private stateCallback: ((state: ShaderDebugState) => void) | null = null;
  private onRecompileNeeded: (() => void) | null = null;
  private onCaptureStateChanged: (() => void) | null = null;
  private customParameters: Map<number, string> = new Map();
  private loopMaxIterations: Map<number, number> = new Map();
  private imageShaderCode: string | null = null;
  private lockedFilePath: string | null = null;
  private lastFunctionName: string | null = null;

  private imagePassPath: string | null = null;
  private bufferPathMap: Record<string, string> = {}; // bufferName → filePath
  private bufferCodes: Record<string, string> = {};
  private variablePreview: VariablePreviewState | null = null;

  public setShaderContext(
    config: ShaderConfig | null,
    imagePath: string | null,
    buffers: Record<string, string>,
  ): void {
    this.bufferCodes = buffers;
    this.bufferPathMap = {};
    const passes = config?.passes ?? {};
    for (const [name, pass] of Object.entries(passes)) {
      if (pass && typeof pass === 'object' && 'path' in pass && typeof pass.path === 'string') {
        this.bufferPathMap[name] = pass.path;
      }
    }
    this.imagePassPath = imagePath && this.isBufferPath(imagePath) ? null : imagePath;
  }

  public getDebugTarget(imageCode: string, config: ShaderConfig | null): DebugTarget {
    const passName = this.variablePreview?.activeBufferName ?? this.state.activeBufferName;
    const code = passName === 'Image'
      ? imageCode
      : this.bufferCodes[passName] ?? imageCode;
    const passConfig = config?.passes[passName];
    const inputConfig = passConfig && 'inputs' in passConfig ? passConfig.inputs : undefined;

    if (!config || passName === 'Image' || passName === 'common') {
      return { passName, code, config, inputConfig };
    }

    if (!passConfig || !('inputs' in passConfig)) {
      return { passName, code, config, inputConfig };
    }

    return {
      passName,
      code,
      config: {
        ...config,
        passes: {
          ...config.passes,
          Image: { ...config.passes.Image, inputs: passConfig.inputs },
        },
      },
      inputConfig,
    };
  }

  private resolveActiveBuffer(filePath: string | null): string {
    if (!filePath) {
      return 'Image';
    }
    if (this.imagePassPath && filePath === this.imagePassPath) {
      return 'Image';
    }
    for (const [name, path] of Object.entries(this.bufferPathMap)) {
      if (filePath === path || filePath.endsWith('/' + path) || path.endsWith('/' + filePath.split('/').pop())) {
        return name;
      }
    }
    return 'Image';
  }

  private isBufferPath(filePath: string): boolean {
    return Object.values(this.bufferPathMap).some((path) =>
      filePath === path ||
      filePath.endsWith('/' + path) ||
      path.endsWith('/' + filePath.split('/').pop()),
    );
  }

  public setStateCallback(callback: (state: ShaderDebugState) => void): void {
    this.stateCallback = callback;
  }

  public setRecompileCallback(callback: () => void): void {
    this.onRecompileNeeded = callback;
  }

  public setCaptureStateCallback(callback: () => void): void {
    this.onCaptureStateChanged = callback;
  }

  public toggleEnabled(): void {
    this.state.isEnabled = !this.state.isEnabled;
    if (!this.state.isEnabled) {
      this.state.isLineLocked = false;
      this.lockedFilePath = null;
      this.variablePreview = null;
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
    this.state.debugNotice = null;
    this.variablePreview = null;
    this.state.activeBufferName = this.resolveActiveBuffer(filePath);
    this.updateActiveState();
    this.updateFunctionContext();
    this.notifyStateChange();
    this.onCaptureStateChanged?.();
  }

  public setVariablePreview(request: VariablePreviewRequest): boolean {
    if (
      !this.state.isEnabled
      || !this.state.isActive
      || this.state.isLineLocked
      || !Number.isInteger(request.debugLine)
      || request.debugLine < 0
      || request.varName.trim() === ''
      || request.varType.trim() === ''
      || request.activeBufferName.trim() === ''
    ) {
      return false;
    }

    if (
      this.variablePreview?.varName === request.varName
      && this.variablePreview.varType === request.varType
      && this.variablePreview.debugLine === request.debugLine
      && this.variablePreview.activeBufferName === request.activeBufferName
      && this.variablePreview.filePath === request.filePath
    ) {
      return false;
    }

    this.variablePreview = {
      varName: request.varName,
      varType: request.varType,
      debugLine: request.debugLine,
      activeBufferName: request.activeBufferName,
      filePath: request.filePath,
      debugError: null,
      debugNotice: null,
    };
    this.notifyStateChange();
    return true;
  }

  public clearVariablePreview(): boolean {
    if (!this.variablePreview) {
      return false;
    }

    this.variablePreview = null;
    this.notifyStateChange();
    return true;
  }

  public getState(): ShaderDebugState {
    if (this.variablePreview) {
      return {
        ...this.state,
        debugError: this.variablePreview.debugError,
        debugNotice: this.variablePreview.debugNotice,
      };
    }

    return { ...this.state };
  }

  public setImageShaderCode(code: string): void {
    this.imageShaderCode = code;
  }

  public setCustomParameter(index: number, value: string | null): void {
    if (value === null) {
      this.customParameters.delete(index);
    } else {
      this.customParameters.set(index, value);
    }
    this.syncFunctionContextParameters();
    this.notifyStateChange();
    this.onRecompileNeeded?.();
    this.onCaptureStateChanged?.();
  }

  public setLoopMaxIterations(loopIndex: number, maxIter: number | null): void {
    if (maxIter === null) {
      this.loopMaxIterations.delete(loopIndex);
    } else {
      this.loopMaxIterations.set(loopIndex, maxIter);
    }
    this.onRecompileNeeded?.();
    this.onCaptureStateChanged?.();
  }

  public getCustomParameters(): Map<number, string> {
    return new Map(this.customParameters);
  }

  public resetCustomParameters(): void {
    if (this.customParameters.size === 0) {
      return;
    }
    this.customParameters.clear();
    this.syncFunctionContextParameters();
    this.notifyStateChange();
    this.onRecompileNeeded?.();
    this.onCaptureStateChanged?.();
  }

  public getLoopMaxIterations(): Map<number, number> {
    return new Map(this.loopMaxIterations);
  }

  public toggleLineLock(): void {
    this.state.isLineLocked = !this.state.isLineLocked;
    if (this.state.isLineLocked) {
      this.lockedFilePath = this.state.filePath;
      this.variablePreview = null;
    } else {
      this.lockedFilePath = null;
    }
    this.notifyStateChange();
  }

  public toggleInlineRendering(): void {
    this.state.isInlineRenderingEnabled = !this.state.isInlineRenderingEnabled;
    this.notifyStateChange();
    this.onRecompileNeeded?.();
  }

  public setInlineRenderingEnabled(enabled: boolean): void {
    if (this.state.isInlineRenderingEnabled === enabled) {
      return;
    }
    this.state.isInlineRenderingEnabled = enabled;
    this.notifyStateChange();
    this.onRecompileNeeded?.();
  }

  public cycleNormalizeMode(): void {
    const modes: NormalizeMode[] = ['off', 'soft', 'abs'];
    const currentIndex = modes.indexOf(this.state.normalizeMode);
    this.state.normalizeMode = modes[(currentIndex + 1) % modes.length];
    this.notifyStateChange();
    this.onRecompileNeeded?.();
  }

  public toggleStep(): void {
    this.state.isStepEnabled = !this.state.isStepEnabled;
    this.notifyStateChange();
    this.onRecompileNeeded?.();
  }

  public setStepEdge(edge: number): void {
    this.state.stepEdge = edge;
    this.notifyStateChange();
    this.onRecompileNeeded?.();
  }

  public setDebugError(error: string | null): void {
    const target = this.variablePreview ?? this.state;
    target.debugError = error;
    if (error) {
      target.debugNotice = null;
    }
    this.notifyStateChange();
  }

  public toggleVariableInspector(): void {
    this.state.isVariableInspectorEnabled = !this.state.isVariableInspectorEnabled;
    if (!this.state.isVariableInspectorEnabled) {
      this.state.capturedVariables = [];
    }
    this.notifyStateChange();
    this.onCaptureStateChanged?.();
  }

  public setVariableInspectorEnabled(enabled: boolean): void {
    if (this.state.isVariableInspectorEnabled === enabled) {
      return;
    }
    this.state.isVariableInspectorEnabled = enabled;
    if (!enabled) {
      this.state.capturedVariables = [];
    }
    this.notifyStateChange();
    this.onCaptureStateChanged?.();
  }

  public setCapturedVariables(vars: CapturedVariable[]): void {
    this.state.capturedVariables = vars;
    this.notifyStateChange();
  }

  private updateActiveState(): void {
    this.state.isActive = this.state.isEnabled &&
                          this.state.currentLine !== null &&
                          this.state.lineContent !== null;
  }

  private updateFunctionContext(): void {
    const context = this.extractFunctionContext(this.state.currentLine, this.state.activeBufferName);

    // Clear custom params when switching functions
    const newFunctionName = context?.functionName ?? null;
    if (newFunctionName !== this.lastFunctionName) {
      this.customParameters.clear();
      this.loopMaxIterations.clear();
      this.lastFunctionName = newFunctionName;
    }

    this.state.functionContext = context;
    this.syncFunctionContextParameters();
  }

  private syncFunctionContextParameters(): void {
    this.syncContextParameters(this.state.functionContext, this.customParameters);
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
   * Modifies shader code to render the active debug target.
   * Variable previews are independent of inline line rendering.
   * Falls back to full-shader post-processing when inline line rendering is off.
   */
  public modifyShaderForDebugging(
    originalCode: string,
    debugLine: number,
  ): string | null {
    const effectiveState = this.getState();
    if (!effectiveState.isActive || effectiveState.lineContent === null) {
      return null;
    }

    let result: string | null;
    let shouldReportMissingVariable = false;
    if (this.variablePreview) {
      result = ShaderDebugger.modifyShaderForVariablePreview(
        originalCode,
        this.variablePreview.debugLine,
        { name: this.variablePreview.varName, type: this.variablePreview.varType },
        this.loopMaxIterations,
        this.customParameters,
        effectiveState.normalizeMode,
        effectiveState.isStepEnabled ? effectiveState.stepEdge : null,
      );
      shouldReportMissingVariable = true;
    } else if (effectiveState.isInlineRenderingEnabled) {
      result = ShaderDebugger.modifyShaderForLineDebug(
        originalCode,
        debugLine,
        effectiveState.lineContent,
        this.loopMaxIterations,
        this.customParameters,
        effectiveState.normalizeMode,
        effectiveState.isStepEnabled ? effectiveState.stepEdge : null,
      );
      shouldReportMissingVariable = true;
    } else {
      result = this.applyFullShaderPostProcessing(originalCode);
    }

    const target = this.variablePreview ?? this.state;
    if (result === null && shouldReportMissingVariable) {
      target.debugError = null;
      target.debugNotice = 'No debuggable variable on this line';
      this.notifyStateChange();
    } else {
      target.debugError = null;
      target.debugNotice = null;
    }

    return result;
  }

  private getCodeForActiveBuffer(activeBufferName: string): string {
    const imageCode = this.imageShaderCode ?? '';
    return activeBufferName === 'Image'
      ? imageCode
      : this.bufferCodes[activeBufferName] ?? imageCode;
  }

  private extractFunctionContext(line: number | null, activeBufferName: string): DebugFunctionContext | null {
    const codeToAnalyse = this.getCodeForActiveBuffer(activeBufferName);
    if (!codeToAnalyse || line === null) {
      return null;
    }

    try {
      return ShaderDebugger.extractFunctionContext(codeToAnalyse, line);
    } catch {
      return null;
    }
  }

  private syncContextParameters(
    context: DebugFunctionContext | null,
    params: Map<number, string>,
  ): DebugFunctionContext | null {
    if (!context) {
      return null;
    }

    context.parameters = context.parameters.map((param, index) => ({
      ...param,
      expression: params.get(index) ?? param.defaultExpression,
    }));
    return context;
  }
}
