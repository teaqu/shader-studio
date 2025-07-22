import { Logger } from "./services/Logger";
import { WebSocketTransport } from "./communication/WebSocketTransport";
import { Messenger } from "./communication/Messenger";

export class WebSocketServerManager {
  private wsTransport: WebSocketTransport | null = null;
  private logger: Logger;
  private messenger: Messenger;
  private port: number = 51472;
  private isRunning: boolean = false;

  constructor(messenger: Messenger, logger: Logger) {
    this.messenger = messenger;
    this.logger = logger;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info("WebSocket server already running");
      return;
    }

    try {
      this.logger.info(`Starting WebSocket server on port ${this.port}`);

      this.wsTransport = new WebSocketTransport(this.port);
      this.messenger.addTransport(this.wsTransport);

      this.isRunning = true;
      this.logger.info(`WebSocket server started on port ${this.port}`);
    } catch (error) {
      this.logger.error(`Failed to start WebSocket server: ${error}`);
      this.isRunning = false;
      throw error;
    }
  }

  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.wsTransport) {
        this.messenger.removeTransport(this.wsTransport);
        this.wsTransport.close();
        this.wsTransport = null;
      }

      this.isRunning = false;
      this.logger.info("WebSocket server stopped");
    } catch (error) {
      this.logger.error(`Error stopping WebSocket server: ${error}`);
    }
  }

  public isServerRunning(): boolean {
    return this.isRunning;
  }

  public getPort(): number {
    return this.port;
  }
}
