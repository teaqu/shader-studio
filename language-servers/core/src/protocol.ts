import type {
  Color,
  ColorInformation,
  ColorPresentation,
  CompletionItem,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  Position,
  Range,
  SignatureHelp,
} from "vscode-languageserver-protocol";

export type ShaderLanguage = "glsl" | "slang";

export interface VersionedDocumentId {
  uri: string;
  languageId: ShaderLanguage;
  version: number;
}

export interface ShaderDocumentSnapshot extends VersionedDocumentId {
  text: string;
}

export interface DocumentPositionParams {
  document: VersionedDocumentId;
  position: Position;
}

export interface ColorPresentationParams {
  document: VersionedDocumentId;
  color: Color;
  range: Range;
}

export interface ServerCapabilities {
  completion: boolean;
  hover: boolean;
  definition: boolean;
  signatureHelp: boolean;
  documentSymbols: boolean;
  diagnostics: boolean;
  documentColors: boolean;
}

export interface LanguageService {
  initialize(): Promise<ServerCapabilities>;
  syncEnvironment(environment: import("@shader-studio/types").ShaderAuthoringEnvironment): Promise<void>;
  openDocument(document: ShaderDocumentSnapshot): Promise<void>;
  changeDocument(document: ShaderDocumentSnapshot): Promise<void>;
  closeDocument(uri: string): Promise<void>;
  completion(params: DocumentPositionParams): Promise<CompletionItem[]>;
  hover(params: DocumentPositionParams): Promise<Hover | null>;
  definition(params: DocumentPositionParams): Promise<Location[]>;
  signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null>;
  documentSymbols(document: VersionedDocumentId): Promise<DocumentSymbol[]>;
  diagnostics(document: VersionedDocumentId): Promise<Diagnostic[]>;
  documentColors(document: VersionedDocumentId): Promise<ColorInformation[]>;
  colorPresentations(params: ColorPresentationParams): Promise<ColorPresentation[]>;
  dispose(): Promise<void>;
}

export type WorkerMethod = Exclude<keyof LanguageService, "dispose"> | "dispose";

export interface WorkerRequest {
  kind: "request";
  id: number;
  method: WorkerMethod;
  params: unknown;
}

export interface WorkerResponse {
  kind: "response";
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface WorkerNotification {
  kind: "notification";
  method: "diagnostics" | "log";
  params: unknown;
}

export type WorkerMessage = WorkerRequest | WorkerResponse | WorkerNotification;

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  if (message.kind === "request") {
    return Number.isFinite(message.id) && typeof message.method === "string";
  }

  if (message.kind === "response") {
    return Number.isFinite(message.id);
  }

  return message.kind === "notification" && typeof message.method === "string";
}
