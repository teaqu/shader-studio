import * as vscode from "vscode";

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.LogOutputChannel;

  private constructor(outputChannel: vscode.LogOutputChannel) {
    this.outputChannel = outputChannel;
  }

  public static initialize(outputChannel: vscode.LogOutputChannel): void {
    Logger.instance = new Logger(outputChannel);
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error("Logger not initialized. Call Logger.initialize() first.");
    }
    return Logger.instance;
  }

  public info(message: string): void {
    this.outputChannel.info(message);
  }

  public debug(message: string): void {
    this.outputChannel.debug(message);
  }

  public warn(message: string): void {
    this.outputChannel.warn(message);
  }

  public error(message: string | Error): void {
    if (message instanceof Error) {
      this.outputChannel.error(message.message);
    } else {
      this.outputChannel.error(message);
    }
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}
