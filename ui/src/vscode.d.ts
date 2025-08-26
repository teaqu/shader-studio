declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
  setState: (state: any) => void;
  getState: () => any;
};

declare global {
  interface Window {
    shaderViewConfig?: {
      port: number;
    };
  }
}
