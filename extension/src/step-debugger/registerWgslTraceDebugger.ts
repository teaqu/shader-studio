import * as vscode from 'vscode';
import { WgslTraceHost } from './WgslTraceHost';
import { WgslTraceSession, type TraceRequest, type TraceProtocolMessage } from './WgslTraceSession';

export function registerWgslTraceDebugger(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('shader-studio-wgsl-trace', {
    createDebugAdapterDescriptor() {
      const emitter = new vscode.EventEmitter<TraceProtocolMessage>();
      const host = new WgslTraceHost(context);
      let closed: vscode.Disposable | undefined;
      const session = new WgslTraceSession(message => emitter.fire(message), async configuration => {
        const recording = await host.capture(configuration);
        closed = host.onClose(() => session.dispose());
        return recording;
      }, () => {
        closed?.dispose(); host.dispose();
      }, () => host.sourceIsCurrent());
      return new vscode.DebugAdapterInlineImplementation({
        onDidSendMessage: emitter.event,
        handleMessage: message => {
          void session.handle(message as TraceRequest);
        },
        dispose: () => {
          session.dispose(); emitter.dispose();
        },
      });
    },
  }));
}
