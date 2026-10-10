export interface SaveFileResultPayload {
  success?: boolean;
  cancelled?: boolean;
  error?: string;
  requestId?: string;
}

export interface SaveFileRequest {
  data: string;
  defaultName: string;
  filters: Record<string, string[]>;
  requestId: string;
}

/**
 * Pairs each capture save with its host reply. Replies are matched by
 * requestId so a stray or late saveFileResult can't settle the wrong save,
 * a newer save supersedes one whose reply never arrived, and a long timeout
 * frees the slot if the reply is lost. A native save dialog can legitimately
 * stay open for minutes, so the timeout is only a safety net.
 */
export class CaptureSaveChannel {
  static readonly DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

  private pending: {
    requestId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private sequence = 0;

  constructor(
    private post: (request: SaveFileRequest) => void,
    private timeoutMs = CaptureSaveChannel.DEFAULT_TIMEOUT_MS,
  ) {}

  save(data: string, defaultName: string, filters: Record<string, string[]>): Promise<void> {
    this.settle(new Error("The previous capture save did not complete"));
    const requestId = `capture-save-${++this.sequence}`;
    const result = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.requestId === requestId) {
          this.settle(new Error("Saving the capture timed out; try again"));
        }
      }, this.timeoutMs);
      this.pending = { requestId, resolve, reject, timer };
    });
    this.post({ data, defaultName, filters, requestId });
    return result;
  }

  /** Returns true when the reply belonged to the outstanding save. */
  handleResult(result: SaveFileResultPayload | undefined): boolean {
    const pending = this.pending;
    const payload = result ?? {};
    // Older hosts don't echo requestId; accept an unlabelled reply only for
    // the single outstanding save.
    if (!pending || (payload.requestId !== undefined && payload.requestId !== pending.requestId)) {
      return false;
    }
    if (payload.success || payload.cancelled || payload.error === "Cancelled") {
      this.settle();
    } else {
      this.settle(new Error(payload.error || "The capture could not be saved"));
    }
    return true;
  }

  dispose(reason = "The viewer closed before the capture was saved"): void {
    this.settle(new Error(reason));
  }

  private settle(error?: Error): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.pending = null;
    clearTimeout(pending.timer);
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve();
    }
  }
}

/**
 * Hot reloads of the same shader keep recording the same canvas; only a
 * message that switches the main shader to a different path ends a Live
 * recording. Buffer/vertex updates and ignored messages never do.
 */
export function shaderMessageEndsLiveRecording(
  targetKind: string,
  incomingPath: string | undefined,
  currentPath: string,
  pathsEqual: (first: string, second: string) => boolean,
): boolean {
  if (targetKind !== "main") {
    return false;
  }
  return !(incomingPath && pathsEqual(incomingPath, currentPath));
}
