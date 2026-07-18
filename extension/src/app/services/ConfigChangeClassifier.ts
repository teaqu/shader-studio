/**
 * Decides how the panel must react to a `.sha.json` change by diffing the
 * last-SENT config against the new content. Verdicts:
 *
 * | Verdict     | Meaning                                            | Engine behavior                                   | Observable guarantees                                                                 |
 * |-------------|----------------------------------------------------|---------------------------------------------------|---------------------------------------------------------------------------------------|
 * | `skip`      | Structurally equal, or only input `muted` changed  | Nothing — no message sent                         | UI mute controls already applied the runtime change; persisted mute is reused on load |
 * | `recompile` | Only live-safe loop fields changed:                | Plain `shaderSource` resend (no `reload` flag).   | Audio/video keep playing (loop reapplied in place by the loaders); ping-pong buffers   |
 * |             | `startTime`, `endTime` on inputs                   | Loaders reapply these idempotently to cached media| keep their contents; `iTime` unaffected; shader caches make this cheap                 |
 * | `reload`    | Anything else changed (paths, types, filter/wrap/  | `shaderSource` resend with `reload: true`: all    | Media playback restarts (audio silent until user action, video re-syncs); buffers      |
 * |             | vflip/grayscale, resolution, passes, script, ...)  | resources destroyed and reloaded on next apply    | wiped; `iTime` NOT reset                                                               |
 *
 * Safe defaults — all resolve to `reload`: no snapshot yet for the path,
 * either config unparseable, or any changed field this classifier does not
 * recognize. NEW CONFIG FIELDS ARE `reload` BY DEFAULT: if you add a field to
 * the config schema that the runtime can apply in place, you must explicitly
 * add it to LIVE_SAFE_LEAF below — otherwise edits to it take the safe,
 * destructive path.
 */
export type ConfigChangeVerdict = "skip" | "recompile" | "reload";

// Mute buttons apply their runtime command before persisting config, so a
// mute-only disk change needs no shader message. Manual config edits are
// picked up on the next load/reset from the persisted value.
const NO_SHADER_UPDATE_LEAF = /^passes\.[^.]+\.inputs\.[^.]+\.muted$/;

// Leaf paths whose changes the runtime applies in place on a plain recompile.
const LIVE_SAFE_LEAF = /^passes\.[^.]+\.inputs\.[^.]+\.(muted|startTime|endTime)$/;

export class ConfigChangeClassifier {
  private readonly snapshots = new Map<string, unknown>();

  /** Record the raw config text that backed a `shaderSource` send (null/unparseable → safe default). */
  public recordSentConfig(configPath: string, rawText: string | null): void {
    if (rawText === null) {
      this.snapshots.delete(configPath);
      return;
    }
    try {
      this.snapshots.set(configPath, JSON.parse(rawText));
    } catch {
      this.snapshots.delete(configPath);
    }
  }

  public classifyChange(configPath: string, newText: string): ConfigChangeVerdict {
    const previous = this.snapshots.get(configPath);
    if (previous === undefined) {
      return "reload";
    }
    let next: unknown;
    try {
      next = JSON.parse(newText);
    } catch {
      return "reload";
    }
    const changed: string[] = [];
    collectChangedPaths(previous, next, "", changed);
    if (changed.length === 0) {
      return "skip";
    }
    if (changed.every((path) => NO_SHADER_UPDATE_LEAF.test(path))) {
      return "skip";
    }
    return changed.every((path) => LIVE_SAFE_LEAF.test(path)) ? "recompile" : "reload";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  return false;
}

// Records the path of every changed subtree. Recurses only while both sides are
// plain objects, so an added/removed/replaced input or pass reports its own
// (non-leaf) path and correctly fails the live-safe allowlist.
function collectChangedPaths(a: unknown, b: unknown, prefix: string, out: string[]): void {
  if (deepEqual(a, b)) {
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      collectChangedPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.push(prefix || "$root");
}
