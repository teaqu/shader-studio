import * as fs from "fs";
import * as path from "path";

let nextTemporaryId = 0;

/** Rename failures Windows reports while another process holds the target open. */
const RENAME_REFUSED_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Replaces a file so a concurrent reader sees either the old or the new
 * contents, never an empty or partial file.
 *
 * `fs.writeFileSync` truncates the target before writing it, and anything
 * reading the file in between (a watcher reloading it, a test polling it) gets
 * an empty string. Writing a sibling temporary file and renaming it over the
 * target swaps the contents in one step. A symlinked target is resolved first
 * so the link itself survives, and an existing file keeps its permissions.
 *
 * If the rename is refused (Windows does this while another process has the
 * target open), the contents are written in place instead: the write still
 * lands, only without the atomicity.
 */
export function writeFileAtomicSync(filePath: string, data: string): void {
  const target = resolveTarget(filePath);
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${nextTemporaryId++}.tmp`,
  );
  const mode = existingMode(target);

  try {
    fs.writeFileSync(temporary, data, "utf-8");
    if (mode !== undefined) {
      // Set explicitly: a mode given at creation is filtered by the umask.
      fs.chmodSync(temporary, mode);
    }
  } catch (error) {
    removeQuietly(temporary);
    throw error;
  }

  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    removeQuietly(temporary);
    if (!RENAME_REFUSED_CODES.has((error as NodeJS.ErrnoException).code ?? "")) {
      throw error;
    }
    fs.writeFileSync(target, data, "utf-8");
  }
}

function resolveTarget(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function existingMode(target: string): number | undefined {
  try {
    return fs.statSync(target).mode & 0o7777;
  } catch {
    return undefined;
  }
}

function removeQuietly(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // The write's own outcome is what the caller needs to hear about.
  }
}
