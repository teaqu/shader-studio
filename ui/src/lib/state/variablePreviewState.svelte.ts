export interface VariablePreviewRequest {
  varName: string;
  varType: string;
  debugLine: number;
  activeBufferName: string;
  filePath: string | null;
}

export interface VariablePreviewState {
  varName: string | null;
  varType: string | null;
  debugLine: number | null;
  activeBufferName: string | null;
  filePath: string | null;
  token: number;
}

const variablePreview = $state<VariablePreviewState>({
  varName: null,
  varType: null,
  debugLine: null,
  activeBufferName: null,
  filePath: null,
  token: 0,
});

export function getVariablePreview(): VariablePreviewState {
  return variablePreview;
}

export function setVariablePreview(request: VariablePreviewRequest): void {
  if (
    variablePreview.varName === request.varName
    && variablePreview.varType === request.varType
    && variablePreview.debugLine === request.debugLine
    && variablePreview.activeBufferName === request.activeBufferName
    && variablePreview.filePath === request.filePath
  ) {
    return;
  }
  variablePreview.varName = request.varName;
  variablePreview.varType = request.varType;
  variablePreview.debugLine = request.debugLine;
  variablePreview.activeBufferName = request.activeBufferName;
  variablePreview.filePath = request.filePath;
  variablePreview.token += 1;
}

export function clearVariablePreview(varName?: string, varType?: string): void {
  if (
    varName !== undefined
    && (variablePreview.varName !== varName || variablePreview.varType !== varType)
  ) {
    return;
  }
  if (variablePreview.varName === null && variablePreview.varType === null) {
    return;
  }
  variablePreview.varName = null;
  variablePreview.varType = null;
  variablePreview.debugLine = null;
  variablePreview.activeBufferName = null;
  variablePreview.filePath = null;
  variablePreview.token += 1;
}

export function resetVariablePreview(): void {
  variablePreview.varName = null;
  variablePreview.varType = null;
  variablePreview.debugLine = null;
  variablePreview.activeBufferName = null;
  variablePreview.filePath = null;
  variablePreview.token = 0;
}
