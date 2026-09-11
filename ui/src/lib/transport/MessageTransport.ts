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

export interface ShaderExplorerHostApi {
  postMessage(message: { type: string; [key: string]: unknown }): void;
  onMessage(handler: (event: MessageEvent) => void): () => void;
}

export interface Transport {
  applyWorkspaceEdit?: (
    changes: readonly { uri: string; before: string; after: string }[],
    isCurrent: () => boolean,
    commit: () => void,
    openTexts?: ReadonlyMap<string, string>,
  ) => Promise<void>;
  getWorkspaceDocuments?: (language: import('@shader-studio/types').ShaderLanguageId) => Promise<NonNullable<import('@shader-studio/types').ShaderAuthoringEnvironment['workspaceDocuments']>>;
  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void;
  onMessage(handler: (event: MessageEvent) => void): void;
  dispose(): void;
  getType(): 'vscode' | 'websocket' | 'web';
  isConnected(): boolean;
}
