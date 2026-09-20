/**
 * Test access to the standalone workspace database.
 *
 * The store keys one record per path in `files`, with `meta/workspace` marking
 * that a workspace exists — an emptied workspace is otherwise indistinguishable
 * from an unused one and would be re-seeded. Tests go through these helpers
 * rather than opening IndexedDB inline so the layout lives in one place.
 */
const DATABASE = 'shader-studio-web';
const VERSION = 2;

/** Read the files, optionally writing records and deleting paths first. */
function workspaceOperation(page, operation) {
  return page.evaluate((operation) => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web', 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('files')) {
        database.createObjectStore('files');
      }
      if (!database.objectStoreNames.contains('meta')) {
        database.createObjectStore('meta');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const writes = (operation.put ?? []).length > 0 || (operation.remove ?? []).length > 0;
      const transaction = database.transaction(['files', 'meta'], writes ? 'readwrite' : 'readonly');
      const files = transaction.objectStore('files');
      for (const file of operation.put ?? []) {
        files.put(file, file.path);
      }
      for (const path of operation.remove ?? []) {
        files.delete(path);
      }
      if (writes) {
        transaction.objectStore('meta').put({ savedAt: Date.now() }, 'workspace');
      }
      const read = files.getAll();
      let result = [];
      read.onsuccess = () => {
        result = read.result ?? [];
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(result.sort((first, second) => first.path.localeCompare(second.path)));
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  }), operation);
}

/** Every workspace file, sorted by path. */
export function readWorkspaceFiles(page) {
  return workspaceOperation(page, {});
}

/** Write whole records, replacing any with the same path. */
export function putWorkspaceFiles(page, files) {
  return workspaceOperation(page, { put: files });
}

/** Delete records by path. */
export function removeWorkspacePaths(page, paths) {
  return workspaceOperation(page, { remove: paths });
}

/** Add `/shaders/<name>` files from `[name, contents]` pairs. */
export function addShaderFiles(page, entries) {
  const at = Date.now();
  return putWorkspaceFiles(page, entries.map(([name, contents]) => ({
    path: `/shaders/${name}`,
    contents,
    createdAt: at,
    modifiedAt: at,
  })));
}

/** Seed the pre-v2 single-array layout, for the migration's own test. */
export function seedLegacyWorkspace(page, files) {
  return page.evaluate((files) => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) {
        request.result.createObjectStore('state');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').put(files, 'workspace');
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  }), files);
}

/** Version, store names, and whether the superseded v1 array is still there. */
export function readWorkspaceLayout(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const stores = [...database.objectStoreNames];
      if (!stores.includes('state')) {
        database.close();
        resolve({ version: database.version, stores, legacyRecord: null });
        return;
      }
      const read = database.transaction('state', 'readonly').objectStore('state').get('workspace');
      read.onsuccess = () => {
        database.close();
        resolve({ version: database.version, stores, legacyRecord: read.result ?? null });
      };
      read.onerror = () => {
        database.close();
        reject(read.error);
      };
    };
  }));
}

export { DATABASE, VERSION };
