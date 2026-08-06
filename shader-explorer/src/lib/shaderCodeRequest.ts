import type { SlangSourceModule } from '@shader-studio/types';

export type ShaderLanguage = 'glsl' | 'slang';

export interface ShaderCodeResponse {
  code: string;
  config: unknown;
  previewPath?: string;
  buffers: Record<string, string>;
  language: ShaderLanguage;
  scriptBundleError?: string;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  slangModules?: SlangSourceModule[];
}

interface ShaderCodeRequestApi {
  postMessage(message: { type: 'requestShaderCode'; path: string; requestId: number }): void;
}

interface RequestShaderCodeOptions {
  vscodeApi: ShaderCodeRequestApi;
  path: string;
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  timeoutMs?: number;
  now?: () => number;
  onSend?: () => void;
  onReceived?: (response: ShaderCodeResponse, elapsedMs: number) => void;
  onTimeout?: (elapsedMs: number) => void;
  signal?: AbortSignal;
}

let nextRequestId = 0;

export function requestShaderCode({
  vscodeApi,
  path,
  target,
  timeoutMs = 5000,
  now = () => performance.now(),
  onSend,
  onReceived,
  onTimeout,
  signal,
}: RequestShaderCodeOptions): Promise<ShaderCodeResponse> {
  const startedAt = now();
  const requestId = ++nextRequestId;

  return new Promise<ShaderCodeResponse>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      target.removeEventListener('message', handleMessage);
      signal?.removeEventListener('abort', handleAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const failOnTimeout = () => {
      cleanup();
      onTimeout?.(now() - startedAt);
      reject(new Error('Timeout loading shader code'));
    };

    const handleAbort = () => {
      cleanup();
      reject(new Error('Shader code request cancelled'));
    };

    function handleMessage(event: Event) {
      const message = (event as MessageEvent).data;
      if (message?.type !== 'shaderCode' || message.path !== path || message.requestId !== requestId) {
        return;
      }

      const response: ShaderCodeResponse = {
        code: message.code,
        config: message.config || null,
        previewPath: message.previewPath,
        buffers: message.buffers || {},
        language: message.language === 'slang' ? 'slang' : 'glsl',
        scriptBundleError: message.scriptBundleError,
        customUniformDeclarations: message.customUniformDeclarations,
        customUniformInfo: message.customUniformInfo,
        slangModules: message.slangModules,
      };
      cleanup();
      onReceived?.(response, now() - startedAt);
      resolve(response);
    }

    target.addEventListener('message', handleMessage);
    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    timeoutId = setTimeout(failOnTimeout, timeoutMs);

    onSend?.();
    vscodeApi.postMessage({
      type: 'requestShaderCode',
      path,
      requestId,
    });
  });
}
