import type { ShaderDebugState } from '../../../lib/types/ShaderDebugState';
import type { PassUniforms } from '../../../../../rendering/src/models/PassUniforms';

export function makeDebugState(overrides: Partial<ShaderDebugState> = {}): ShaderDebugState {
  return {
    isEnabled: true,
    currentLine: 5,
    lineContent: 'float d = length(p) - r;',
    filePath: '/test.glsl',
    isActive: true,
    functionContext: null,
    isLineLocked: false,
    isInlineRenderingEnabled: true,
    normalizeMode: 'off' as const,
    isStepEnabled: false,
    stepEdge: 0.5,
    debugError: null,
    debugNotice: null,
    isVariableInspectorEnabled: false,
    isErrorsEnabled: false,
    capturedVariables: [],
    activeBufferName: 'Image',
    ...overrides,
  };
}

export const mockUniforms: PassUniforms = {
  time: 1.5,
  res: [800, 600, 1],
  mouse: [400, 300, 0, 0],
  frame: 90,
  timeDelta: 0.0167,
  frameRate: 60.0,
  date: [2024, 1, 15, 12345.0],
  channelTime: [0, 0, 0, 0],
  sampleRate: 44100,
  channelLoaded: [0, 0, 0, 0],
  cameraPos: [0, 0, 5],
  cameraDir: [0, 0, -1],
};

export function mockGetUniforms(): PassUniforms | null {
  return mockUniforms;
}
