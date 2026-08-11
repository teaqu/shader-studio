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

export interface DocumentRevision extends VersionedDocumentId {
  environmentGeneration: number;
}

export interface DocumentParams {
  document: DocumentRevision;
}

export interface DocumentPositionParams {
  document: DocumentRevision;
  position: Position;
}

export interface ColorPresentationParams {
  document: DocumentRevision;
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
  documentSymbols(params: DocumentParams): Promise<DocumentSymbol[]>;
  diagnostics(params: DocumentParams): Promise<Diagnostic[]>;
  documentColors(params: DocumentParams): Promise<ColorInformation[]>;
  colorPresentations(params: ColorPresentationParams): Promise<ColorPresentation[]>;
  dispose(): Promise<void>;
}

export type WorkerMethod = Exclude<keyof LanguageService, "dispose"> | "dispose";
export type DocumentAnalysisMethod =
  | "completion"
  | "hover"
  | "definition"
  | "signatureHelp"
  | "documentSymbols"
  | "diagnostics"
  | "documentColors"
  | "colorPresentations";
export type LifecycleWorkerMethod = Exclude<WorkerMethod, DocumentAnalysisMethod>;

export interface WorkerRequest {
  kind: "request";
  id: number;
  method: WorkerMethod;
  params: unknown;
}

interface WorkerResponseEnvelope {
  kind: "response";
  id: number;
}

interface WorkerSuccess {
  result: unknown;
  error?: never;
}

interface WorkerFailure {
  result?: never;
  error: { code: string; message: string };
}

type WorkerOutcome = WorkerSuccess | WorkerFailure;

export type AnalysisWorkerResponse = WorkerResponseEnvelope & WorkerOutcome & {
  method: DocumentAnalysisMethod;
  revision: DocumentRevision;
};

export type LifecycleWorkerResponse = WorkerResponseEnvelope & WorkerOutcome & {
  method: LifecycleWorkerMethod;
  revision?: never;
};

export type WorkerResponse = AnalysisWorkerResponse | LifecycleWorkerResponse;

export interface DiagnosticsWorkerNotification {
  kind: "notification";
  method: "diagnostics";
  revision: DocumentRevision;
  params: unknown;
}

export interface LogWorkerNotification {
  kind: "notification";
  method: "log";
  params: unknown;
}

export type WorkerNotification = DiagnosticsWorkerNotification | LogWorkerNotification;
export type WorkerMessage = WorkerRequest | WorkerResponse | WorkerNotification;

const DOCUMENT_ANALYSIS_METHODS = new Set<DocumentAnalysisMethod>([
  "completion",
  "hover",
  "definition",
  "signatureHelp",
  "documentSymbols",
  "diagnostics",
  "documentColors",
  "colorPresentations",
]);

const WORKER_METHODS = new Set<WorkerMethod>([
  "initialize",
  "syncEnvironment",
  "openDocument",
  "changeDocument",
  "closeDocument",
  ...DOCUMENT_ANALYSIS_METHODS,
  "dispose",
]);

const NOTIFICATION_METHODS = new Set<string>(["diagnostics", "log"]);

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  if (message.kind === "request") {
    if (
      !Number.isFinite(message.id)
      || typeof message.method !== "string"
      || !isWorkerMethod(message.method)
      || !hasOwnProperty(message, "params")
    ) {
      return false;
    }
    if (isDocumentAnalysisMethod(message.method)) {
      return isDocumentRevision(asRecord(message.params)?.document);
    }
    return true;
  }

  if (message.kind === "response") {
    if (
      !Number.isFinite(message.id)
      || typeof message.method !== "string"
      || !isWorkerMethod(message.method)
      || !hasExactlyOneOutcome(message)
    ) {
      return false;
    }
    if (isDocumentAnalysisMethod(message.method)) {
      return isDocumentRevision(message.revision);
    }
    return message.revision === undefined;
  }

  if (
    message.kind !== "notification"
    || typeof message.method !== "string"
    || !NOTIFICATION_METHODS.has(message.method)
    || !hasOwnProperty(message, "params")
  ) {
    return false;
  }
  return message.method !== "diagnostics" || isDocumentRevision(message.revision);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function isDocumentRevision(value: unknown): value is DocumentRevision {
  const revision = asRecord(value);
  return revision !== undefined
    && typeof revision.uri === "string"
    && (revision.languageId === "glsl" || revision.languageId === "slang")
    && Number.isFinite(revision.version)
    && Number.isFinite(revision.environmentGeneration);
}

function isWorkerError(value: unknown): value is NonNullable<WorkerResponse["error"]> {
  const error = asRecord(value);
  return error !== undefined
    && typeof error.code === "string"
    && typeof error.message === "string";
}

function isWorkerMethod(method: string): method is WorkerMethod {
  return WORKER_METHODS.has(method as WorkerMethod);
}

function isDocumentAnalysisMethod(method: WorkerMethod): method is DocumentAnalysisMethod {
  return DOCUMENT_ANALYSIS_METHODS.has(method as DocumentAnalysisMethod);
}

function hasExactlyOneOutcome(message: Record<string, unknown>): boolean {
  const hasResult = hasOwnProperty(message, "result");
  const hasError = hasOwnProperty(message, "error");
  return hasResult !== hasError && (!hasError || isWorkerError(message.error));
}

function hasOwnProperty(message: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(message, property);
}
