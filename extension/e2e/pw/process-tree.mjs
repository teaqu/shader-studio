import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Include start identity: a recycled PID must never receive our signal. */
export function parseProcessTable(text) {
  return text.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      return [];
    }
    const [, pid, ppid, rss, started, state, command] = match;
    return [{ pid: Number(pid), ppid: Number(ppid), rssKiB: Number(rss), started, state, command }];
  });
}

export async function readProcessTable() {
  if (process.platform === 'win32') {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CreationDate,CommandLine | ConvertTo-Json -Compress'],
    { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    const rows = JSON.parse(stdout || '[]');
    return (Array.isArray(rows) ? rows : [rows]).map(row => ({
      pid: row.ProcessId, ppid: row.ParentProcessId, rssKiB: Number(row.WorkingSetSize) / 1024,
      started: String(row.CreationDate), state: 'R', command: row.CommandLine ?? '',
    }));
  }
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=,lstart=,stat=,command='], {
    timeout: 5000, maxBuffer: 8 * 1024 * 1024,
  });
  return parseProcessTable(stdout);
}

export function processRole(row, rootPid) {
  if (row.pid === rootPid) {
    return 'electron-main';
  }
  if (/--type=gpu-process/.test(row.command)) {
    return 'gpu';
  }
  if (/--type=renderer/.test(row.command)) {
    return 'renderer'; // ps cannot reliably distinguish workbench from webview.
  }
  if (/extensionHost|node\.mojom\.NodeService/.test(row.command)) {
    return 'node-service'; // Includes the extension host and shared process.
  }
  return 'utility';
}

/** Track descendants before reparenting, and retain their birth identities. */
export function updateOwnedProcesses(owned, rows) {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const live = new Set([...owned].filter(([pid, birth]) => byPid.get(pid)?.started === birth.started).map(([pid]) => pid));
  let changed;
  do {
    changed = false;
    for (const row of rows) {
      if (live.has(row.ppid) && !owned.has(row.pid)) {
        owned.set(row.pid, row);
        live.add(row.pid);
        changed = true;
      }
    }
  } while (changed);
  return rows.filter(row => live.has(row.pid) && !row.state.startsWith('Z'));
}

/** One sampler owns one launched process tree; never select by executable name. */
export async function monitorProcessTree(rootPid, {
  read = readProcessTable, signal = (pid, name) => process.kill(pid, name),
  intervalMs = 1000, sample = () => {},
} = {}) {
  const rows = await read();
  const root = rows.find(row => row.pid === rootPid);
  if (!root) {
    throw new Error(`Launched Electron PID ${rootPid} was not found in the process inventory`);
  }
  const owned = new Map([[rootPid, root]]);
  let latest = [];
  let peakRssKiB = 0;
  let peakRoles = {};
  const samplingErrors = [];
  let inFlight = Promise.resolve();
  let pendingReads = 0;
  let stopped = false;
  const refresh = async () => {
    latest = updateOwnedProcesses(owned, await read());
    const rssKiB = latest.reduce((total, row) => total + row.rssKiB, 0);
    const roles = {};
    for (const row of latest) {
      const role = processRole(row, rootPid);
      roles[role] = (roles[role] ?? 0) + row.rssKiB;
    }
    if (rssKiB > peakRssKiB) {
      peakRssKiB = rssKiB;
      peakRoles = roles;
    }
    try {
      sample({ phase: 'process-sample', rootPid, rssKiB, roles, processes: latest.map(row => ({
        pid: row.pid, ppid: row.ppid, role: processRole(row, rootPid), rssKiB: row.rssKiB,
      })) });
    } catch (error) {
      // Observer failures must not invalidate authoritative cleanup reads.
      if (samplingErrors.length < 10) {
        samplingErrors.push(error.message);
      }
    }
    return latest;
  };
  const inspect = () => {
    // A failed periodic sample must not poison authoritative cleanup reads.
    pendingReads++;
    inFlight = inFlight.catch(() => {}).then(refresh).finally(() => {
      pendingReads--;
    });
    return inFlight;
  };
  await inspect();
  const timer = setInterval(() => {
    // Coalesce observer ticks; explicit cleanup inspections still read afresh.
    if (stopped || pendingReads) {
      return;
    }
    inspect().catch(error => {
      if (samplingErrors.length < 10) {
        samplingErrors.push(error.message);
      }
    });
  }, intervalMs);
  timer.unref();
  return {
    inspect,
    summary: () => ({ rootPid, peakRssKiB, peakRoles, samplingErrors }),
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight.catch(() => {});
    },
    terminate: async name => {
      await inspect();
      const depth = row => {
        let parent = owned.get(row.ppid);
        const visited = new Set([row.pid]);
        while (parent && !visited.has(parent.pid)) {
          visited.add(parent.pid);
          parent = owned.get(parent.ppid);
        }
        return visited.size;
      };
      // Children first; every signal uses a refreshed exact birth identity.
      for (const row of [...latest].sort((a, b) => depth(b) - depth(a))) {
        const current = (await read()).find(candidate => candidate.pid === row.pid);
        if (current?.started !== row.started || current.state.startsWith('Z')) {
          continue;
        }
        try {
          signal(row.pid, name);
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
    },
  };
}

async function waitForExit(tree, durationMs) {
  const deadline = Date.now() + durationMs;
  do {
    if (!(await tree.inspect()).length) {
      return true;
    }
    await pause(Math.min(100, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  return false;
}

/** Preserve graceful close, then verify exit or terminate this owned tree. */
export async function closeOwnedProcessTree(close, tree, {
  gracefulMs = 15000, terminateMs = 2000, killMs = 2000,
} = {}) {
  let timeout;
  let closeError;
  let graceful = false;
  try {
    await tree.inspect();
    graceful = await Promise.race([
      Promise.resolve().then(close).then(() => true, error => {
        closeError = error.message;
        return false;
      }),
      new Promise(resolve => {
        timeout = setTimeout(() => resolve(false), gracefulMs);
      }),
    ]);
    clearTimeout(timeout);
    let exited = await waitForExit(tree, graceful ? terminateMs : 0);
    const forced = !exited;
    if (!exited) {
      await tree.terminate('SIGTERM');
      exited = await waitForExit(tree, terminateMs);
    }
    if (!exited) {
      await tree.terminate('SIGKILL');
      exited = await waitForExit(tree, killMs);
    }
    if (!exited) {
      const survivors = await tree.inspect();
      throw new Error(`Owned process tree did not exit: ${JSON.stringify(survivors)}`);
    }
    return { graceful, forced, ...(closeError ? { closeError } : {}), ...tree.summary() };
  } finally {
    clearTimeout(timeout);
    await tree.stop();
  }
}
