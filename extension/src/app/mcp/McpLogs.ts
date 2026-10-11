import { format } from 'node:util';

interface LogEntry {
  id: number;
  timestamp: string;
  source: 'extension' | 'script' | 'viewer';
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  previewId?: string;
}

/** Bounded in-memory diagnostic history; never persisted or sent unsolicited. */
export class McpLogs {
  private entries: LogEntry[] = [];
  private sequence = 0;

  constructor(private readonly capacity = 500) {}

  append(source: LogEntry['source'], level: LogEntry['level'], message: string, previewId?: string): void {
    this.entries.push({ id: ++this.sequence, timestamp: new Date().toISOString(), source, level, message: message.slice(0, 4096), ...(previewId ? { previewId } : {}) });
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  read(options: Record<string, unknown>): Record<string, unknown> {
    const after = typeof options.after === 'number' ? options.after : 0;
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 100));
    const matches = this.entries.filter(entry => entry.id > after
      && (!options.previewId || !entry.previewId || entry.previewId === options.previewId)
      && (!options.level || entry.level === options.level));
    const entries = matches.slice(0, limit);
    const hasMore = matches.length > entries.length;
    return {
      entries, nextCursor: hasMore ? entries[entries.length - 1].id : this.sequence, hasMore,
      droppedBeforeCursor: after > 0 && this.entries.length > 0 && after < this.entries[0].id - 1,
    };
  }

  recordViewer(previewId: string, message: Record<string, unknown>): void {
    const levels = { log: 'info', debug: 'debug', warning: 'warning', error: 'error' } as const;
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
      mcpLogs.append('script', level, `${scriptPath ?? 'uniform script'}: ${format(...args)}`);
      // Preserve the script's explicit console call as well as the retained copy.
      // eslint-disable-next-line no-console
      console[method](...args);
    };
  }
  return wrapped;
}
