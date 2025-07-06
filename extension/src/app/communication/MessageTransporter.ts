import * as vscode from "vscode";
import { MessageHandler } from "./MessageHandler";
import { MessageTransport } from "./MessageTransport";

export class MessageTransporter {
  private messageHandler: MessageHandler;
  private transports: MessageTransport[] = [];

  constructor(
    outputChannel: vscode.LogOutputChannel,
    diagnosticCollection: vscode.DiagnosticCollection
  ) {
    this.messageHandler = new MessageHandler(outputChannel, diagnosticCollection);
  }

  send(message: any): void {
    // Send to all transports
    this.transports.forEach(transport => transport.send(message));
  }

  convertUriForClient(filePath: string): string {
    // Use the first transport's URI conversion, or could be made context-aware
    return this.transports[0]?.convertUriForClient(filePath) || filePath;
  }

  close(): void {
    this.transports.forEach(transport => transport.close());
  }

  addTransport(transport: MessageTransport): void {
    this.transports.push(transport);
    transport.onMessage((message) => this.messageHandler.handleMessage(message));
  }

  removeTransport(transport: MessageTransport): void {
    const index = this.transports.indexOf(transport);
    if (index > -1) {
      this.transports.splice(index, 1);
    }
  }
}
