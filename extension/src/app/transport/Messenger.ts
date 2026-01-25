import * as vscode from "vscode";
import { MessageHandler } from "./MessageHandler";
import { MessageTransport } from "./MessageTransport";
import { ErrorHandler } from "../ErrorHandler";

export class Messenger {
  private messageHandler: MessageHandler;
  private transports: MessageTransport[] = [];

  constructor(
    outputChannel: vscode.LogOutputChannel,
    errorHandler: ErrorHandler
  ) {
    this.messageHandler = new MessageHandler(outputChannel, errorHandler);
  }

  public send(message: any): void {
    try {
      const messageStr = JSON.stringify(message);
      const messageSize = new Blob([messageStr]).size;

      if (message.type === 'shader') {
        console.log(`Messenger: Sending shader message (${messageSize} bytes) to ${this.transports.length} transports`);
        if (message.payload && message.payload.code) {
          console.log(`Messenger: Shader code length: ${message.payload.code.length} characters`);
        }
      } else {
        console.log(`Messenger: Sending ${message.type} (${messageSize} bytes) to ${this.transports.length} transports`);
      }

      // Send to all transports
      this.transports.forEach((transport, index) => {
        try {
          transport.send(message);
        } catch (error) {
          console.error(`Messenger: Error sending to transport ${index}:`, error);
        }
      });
    } catch (error) {
      console.error('Messenger: Error in send method:', error);
    }
  }

  public close(): void {
    this.transports.forEach(transport => transport.close());
  }

  public addTransport(transport: MessageTransport): void {
    this.transports.push(transport);
    transport.onMessage((message) => this.messageHandler.handleMessage(message));
  }

  public removeTransport(transport: MessageTransport): void {
    const index = this.transports.indexOf(transport);
    if (index > -1) {
      this.transports.splice(index, 1);
    }
  }

  public hasActiveClients(): boolean {
    return this.transports.some(transport => transport.hasActiveClients());
  }
}
