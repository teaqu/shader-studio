import type {
  BaseMessage,
  CreateFileMessage,
  SelectFileMessage,
} from '@shader-studio/types';

export type TransportMessage<TMessage extends BaseMessage> = TMessage & (
  TMessage extends { type: 'selectFile' }
    ? SelectFileMessage
    : TMessage extends { type: 'createFile' }
      ? CreateFileMessage
      : TMessage
);

export interface Transport {
  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void;
  onMessage(handler: (event: MessageEvent) => void): void;
  dispose(): void;
  getType(): 'vscode' | 'websocket';
  isConnected(): boolean;
}
