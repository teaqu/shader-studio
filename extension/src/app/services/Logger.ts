import * as vscode from "vscode";

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.LogOutputChannel;
  private recentMessages = new Map<string, number>();
  private readonly DEBOUNCE_MS = 500; // 0.5 second debounce

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
    // Check if this message was recently logged (debounce)
    const now = Date.now();
    const lastShown = this.recentMessages.get(message);
    
    if (lastShown && (now - lastShown) < this.DEBOUNCE_MS) {
      // Skip this message - it was logged recently
      return;
    }
    
    // Record this message as logged
    this.recentMessages.set(message, now);
    
    // Clean up old messages from the map (prevent memory leak)
    this.cleanupOldMessages(now);
    
    this.outputChannel.warn(message);
  }

  public error(message: string | Error): void {
    const messageText = message instanceof Error ? message.message : message;
    
    // Check if this message was recently logged (debounce)
    const now = Date.now();
    const lastShown = this.recentMessages.get(messageText);
    
    if (lastShown && (now - lastShown) < this.DEBOUNCE_MS) {
      // Skip this message - it was logged recently
      return;
    }
    
    // Record this message as logged
    this.recentMessages.set(messageText, now);
    
    // Clean up old messages from the map (prevent memory leak)
    this.cleanupOldMessages(now);
    
    this.outputChannel.error(messageText);
  }

  private cleanupOldMessages(now: number): void {
    // Remove messages older than DEBOUNCE_MS from the map
    for (const [message, timestamp] of this.recentMessages.entries()) {
      if (now - timestamp > this.DEBOUNCE_MS) {
        this.recentMessages.delete(message);
      }
    }
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}
