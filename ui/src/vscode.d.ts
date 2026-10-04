declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  setState: (state: unknown) => void;
  getState: () => unknown;
};

interface Window {
  shaderViewConfig?: {
    port: number;
  };
}
