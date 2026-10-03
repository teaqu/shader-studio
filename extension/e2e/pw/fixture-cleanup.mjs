import { rmSync } from 'node:fs';
import { closeOwnedProcessTree } from './process-tree.mjs';

async function closeBounded(close, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(close).then(
        () => ({ completed: true }),
        error => ({ completed: false, error }),
      ),
      new Promise(resolve => {
        timer = setTimeout(() => resolve({ completed: false, timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function diagnostic(error, message) {
  const result = new Error(message, { cause: error });
  return result;
}

/**
 * Close one E2E worker's resources. A profile is removed only after exact
 * owned-process exit verification; the private display is always closed.
 */
export async function cleanupFixture({
  app,
  processTree,
  processPid,
  userDataDir,
  windowDisplay,
  closeTree = closeOwnedProcessTree,
  removeProfile = path => rmSync(path, { recursive: true, force: true }),
  gracefulCloseMs = 15_000,
  phase = () => {},
} = {}) {
  let result;
  let failure;
  try {
    if (!processTree) {
      const close = await closeBounded(() => app.close(), gracefulCloseMs);
      const detail = close.timedOut
        ? `graceful close timed out after ${gracefulCloseMs}ms`
        : close.error ? `graceful close failed: ${close.error.message}` : 'process inventory was unavailable';
      throw new Error(`Cannot verify owned Electron process exit (PID ${processPid}); profile retained at ${userDataDir}: ${detail}`);
    }

    let closeAttempted = false;
    try {
      result = await closeTree(() => {
        closeAttempted = true;
        return app.close();
      }, processTree, { phase });
    } catch (error) {
      // A fresh inventory failure before graceful close still needs one close
      // attempt; later failures must not add a second 15-second close window.
      const close = closeAttempted ? {} : await closeBounded(() => app.close(), gracefulCloseMs);
      const detail = close.timedOut
        ? `; subsequent graceful close timed out after ${gracefulCloseMs}ms`
        : close.error ? `; subsequent graceful close failed: ${close.error.message}` : '';
      throw diagnostic(error, `Cannot verify owned Electron process exit (PID ${processPid}); profile retained at ${userDataDir}: ${error.message}${detail}`);
    }

    try {
      removeProfile(userDataDir);
    } catch (error) {
      throw diagnostic(error, `Owned Electron process exit was verified, but profile removal failed at ${userDataDir}: ${error.message}`);
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      await windowDisplay.close();
    } catch (error) {
      if (failure) {
        failure.message += `; private display cleanup failed: ${error.message}`;
      } else {
        failure = diagnostic(error, `Electron exited but private display cleanup failed (PID ${processPid})`);
      }
    }
  }
  if (failure) {
    throw failure;
  }
  return result;
}

/** Keep the primary setup/test error while retaining the cleanup diagnosis. */
export function attachCleanupFailure(originalError, cleanupError) {
  if (originalError.cause === undefined || originalError.cause === null) {
    originalError.cause = cleanupError;
  } else {
    originalError.cleanupError = cleanupError;
  }
  return originalError;
}
