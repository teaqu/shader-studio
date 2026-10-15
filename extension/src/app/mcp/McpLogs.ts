import { format } from 'node:util';

interface LogEntry {
  id: number;
  timestamp: string;
  source: 'extension' | 'script' | 'viewer';
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  previewId?: string;
}

/** Opt-in, time-bounded diagnostic history; never persisted or sent unsolicited. */
export class McpLogs {
  private entries: LogEntry[] = [];
  private sequence = 0;
  private enabled = false;
  private expiresAt = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.expiresAt = 0;
      this.entries = [];
    }
  }

  get collecting(): boolean {
    return this.enabled && Date.now() < this.expiresAt;
  }

  start(duration = 60) {
    if (!this.enabled) {
      throw new Error('MCP is disabled.');
    }
    if (!Number.isFinite(duration) || duration < 1 || duration > 300) {
      throw new Error('Log collection duration must be between 1 and 300 seconds.');
    }
    this.entries = [];
    this.expiresAt = Date.now() + duration * 1000;
    return this.read({});
  }

  stop() {
    this.expiresAt = 0;
    return this.read({});
  }

  constructor(private readonly capacity = 500) {}

  append(source: LogEntry['source'], level: LogEntry['level'], message: string, previewId?: string): void {
    if (!this.collecting) {
      return;
    }
    this.entries.push({ id: ++this.sequence, timestamp: new Date().toISOString(), source, level, message: message.slice(0, 4096), ...(previewId ? { previewId } : {}) });
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  read(options: Record<string, unknown>) {
    const after = typeof options.after === 'number' ? options.after : 0;
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
    const matches = this.entries.filter(entry => entry.id > after
      && (!options.previewId || !entry.previewId || entry.previewId === options.previewId)
      && (!options.level || entry.level === options.level));
    const entries = matches.slice(0, limit);
    const hasMore = matches.length > entries.length;
    return {
      collecting: this.collecting, expiresAt: this.expiresAt ? new Date(this.expiresAt).toISOString() : null,
      entries, nextCursor: hasMore ? entries[entries.length - 1].id : this.sequence, hasMore,
      droppedBeforeCursor: after > 0 && this.entries.length > 0 && after < this.entries[0].id - 1,
    };
  }

  recordViewer(previewId: string, message: Record<string, unknown>): void {
    if (!this.collecting) {
      return;
    }
    const levels = { log: 'info', debug: 'debug', warning: 'warning', error: 'error' } as const;
    if (typeof message.type !== 'string' || !Object.hasOwn(levels, message.type)) {
      return;
    }
    const level = levels[message.type as keyof typeof levels];
    if (level && message.payload !== undefined) {
      const text = Array.isArray(message.payload) ? message.payload.slice(0, 32).join('\n') : String(message.payload);
      this.append('viewer', level, text, previewId);
    }
  }
}

export const mcpLogs = new McpLogs();

/** Preserve script console behavior while retaining a bounded diagnostic copy. */
export function scriptConsole(scriptPath?: string): Console {
  const wrapped = Object.create(console) as Console;
  for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
    wrapped[method] = (...args: unknown[]) => {
      const level = method === 'warn' ? 'warning' : method === 'log' ? 'info' : method;
      if (mcpLogs.collecting) {
        mcpLogs.append('script', level, `${scriptPath ?? 'uniform script'}: ${format(...args)}`);
      }
      // Preserve the script's explicit console call as well as the retained copy.
      // eslint-disable-next-line no-console
      console[method](...args);
    };
  }
  return wrapped;
}
