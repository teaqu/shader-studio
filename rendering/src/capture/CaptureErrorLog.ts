/**
 * A capture issues one shader per variable, so one variable failing says
 * nothing about the rest. Recording only the most recent message - as both
 * capturers used to - collapsed several failures into one and lost which
 * variable each belonged to, leaving the panel unable to report what it had
 * and had not managed to capture.
 */

export interface CaptureError {
  /** The variable the failure belongs to, when it is attributable to one. */
  varName?: string;
  message: string;
}

/** Guards against a realtime capture loop growing the list without bound. */
const MAX_ENTRIES = 64;

export class CaptureErrorLog {
  private entries: CaptureError[] = [];

  clear(): void {
    this.entries = [];
  }

  /** Records one failure, ignoring an exact repeat of one already held. */
  record(message: string | null | undefined, varName?: string): void {
    const text = message?.trim();
    if (!text) {
      return;
    }
    if (this.entries.some((entry) => entry.message === text && entry.varName === varName)) {
      return;
    }
    if (this.entries.length >= MAX_ENTRIES) {
      return;
    }
    this.entries.push(varName === undefined ? { message: text } : { varName, message: text });
  }

  /** Every failure since the last clear, in the order they happened. */
  list(): readonly CaptureError[] {
    return this.entries;
  }

  /** The most recent message, for callers that still want a single string. */
  get lastMessage(): string | null {
    // Indexed rather than `at(-1)`: this package's tsconfig lib predates it.
    return this.entries.length > 0 ? this.entries[this.entries.length - 1].message : null;
  }

  /** One line per failure, naming the variable where there is one. */
  format(): string | null {
    if (this.entries.length === 0) {
      return null;
    }
    return this.entries
      .map((entry) => (entry.varName ? `${entry.varName}: ${entry.message}` : entry.message))
      .join("\n");
  }
}
