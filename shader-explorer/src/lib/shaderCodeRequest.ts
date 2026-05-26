export interface ShaderCodeResponse {
  code: string;
  config: unknown;
  buffers: Record<string, string>;
}

interface ShaderCodeRequestApi {
  postMessage(message: { type: 'requestShaderCode'; path: string }): void;
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
}

export function requestShaderCode({
  vscodeApi,
  path,
  target,
  timeoutMs = 5000,
  now = () => performance.now(),
  onSend,
  onReceived,
  onTimeout,
}: RequestShaderCodeOptions): Promise<ShaderCodeResponse> {
  const startedAt = now();

  return new Promise<ShaderCodeResponse>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      target.removeEventListener('message', handleMessage);
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

    function handleMessage(event: Event) {
      const message = (event as MessageEvent).data;
      if (message?.type !== 'shaderCode' || message.path !== path) {
        return;
      }

      const response: ShaderCodeResponse = {
        code: message.code,
        config: message.config || null,
        buffers: message.buffers || {},
      };
      cleanup();
      onReceived?.(response, now() - startedAt);
      resolve(response);
    }

    target.addEventListener('message', handleMessage);
    timeoutId = setTimeout(failOnTimeout, timeoutMs);

    onSend?.();
    vscodeApi.postMessage({
      type: 'requestShaderCode',
      path,
    });
  });
}
