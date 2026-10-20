import { BrowserScriptWorker } from './BrowserScriptWorker';
const runtime = new BrowserScriptWorker(message => self.postMessage(message), {
  console, WebSocket, fetch, TextEncoder, TextDecoder,
});
self.onmessage = event => runtime.handle(event.data);
