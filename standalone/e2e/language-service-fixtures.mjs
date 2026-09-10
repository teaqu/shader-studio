export async function workspace(page, entries) {
  return page.evaluate((entries) => new Promise((resolve, reject) => {
    const request = indexedDB.open('shader-studio-web', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state', entries ? 'readwrite' : 'readonly');
      const store = tx.objectStore('state');
      const read = store.get('workspace');
      let files;
      read.onsuccess = () => {
        files = read.result ?? [];
        if (entries) {
          for (const [name, contents] of entries) files.push({ path: `/shaders/${name}`, contents, createdAt: Date.now(), modifiedAt: Date.now() });
          store.put(files, 'workspace');
        }
      };
      tx.oncomplete = () => { db.close(); resolve(Object.fromEntries(files.map(file => [file.path, file.contents]))); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), entries);
}

