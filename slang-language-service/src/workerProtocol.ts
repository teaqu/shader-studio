import type {
  CompletionItemDto,
  DiagnosticDto,
  DocumentSymbolDto,
  HoverDto,
  LocationDto,
  SignatureHelpDto,
} from "./SlangWorkspace";
import type { SlangCompletionContext } from "./slangApi";
import type { SlangDocumentSnapshot, SlangPosition, SlangWorkspaceSnapshot } from "./types";

interface RequestBase {
  id: number;
}

export type SlangWorkerRequest =
  | (RequestBase & { method: "init"; snapshot: SlangWorkspaceSnapshot })
  | (RequestBase & { method: "replaceFiles"; snapshot: SlangWorkspaceSnapshot })
  | (RequestBase & { method: "openDocument"; document: SlangDocumentSnapshot })
  | (RequestBase & { method: "changeDocument"; document: SlangDocumentSnapshot })
  | (RequestBase & { method: "closeDocument"; uri: string; documentVersion: number })
  | (RequestBase & { method: "hover"; uri: string; position: SlangPosition; documentVersion: number })
  | (RequestBase & { method: "definition"; uri: string; position: SlangPosition; documentVersion: number })
  | (RequestBase & {
      method: "completion";
      uri: string;
      position: SlangPosition;
      context: SlangCompletionContext;
      documentVersion: number;
    })
  | (RequestBase & { method: "completionResolve"; uri: string; item: CompletionItemDto; documentVersion: number })
  | (RequestBase & { method: "signatureHelp"; uri: string; position: SlangPosition; documentVersion: number })
  | (RequestBase & { method: "documentSymbols"; uri: string; documentVersion: number })
  | (RequestBase & { method: "diagnostics"; uri: string; documentVersion: number });

type WithoutRequestId<T> = T extends RequestBase ? Omit<T, "id"> : never;

export type SlangWorkerRequestPayload = WithoutRequestId<SlangWorkerRequest>;

export type SlangWorkerQueryResult =
  | HoverDto
  | LocationDto[]
  | CompletionItemDto
  | CompletionItemDto[]
  | SignatureHelpDto
  | DocumentSymbolDto[]
  | DiagnosticDto[]
  | undefined;

export type SlangWorkerResponse =
  | { id: number; ok: true; result: unknown; documentVersion?: number }
  | { id: number; ok: false; error: string; documentVersion?: number };
