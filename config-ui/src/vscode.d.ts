/// <reference types="vscode-webview" />

declare global {
    const acquireVsCodeApi: () => {
        postMessage: (message: any) => void;
        setState: (state: any) => void;
        getState: () => any;
    };
}
