import type { SlangApi, SlangList } from "./slangApi";

export function copyList<T, R>(handle: SlangList<T>, copy: (value: T) => R): R[] {
  try {
    const result: R[] = [];
    for (let index = 0; index < handle.size(); index += 1) {
      const value = handle.get(index);
      if (value !== undefined) {
        result.push(copy(value));
      }
    }
    return result;
  } finally {
    handle.delete();
  }
}

export function copyOptionalList<T, R>(
  handle: SlangList<T> | undefined,
  copy: (value: T) => R,
): R[] | undefined {
  return handle === undefined ? undefined : copyList(handle, copy);
}

export function createSlangApi(module: {
  FS: SlangApi["FS"];
  TextEditList: new () => ReturnType<SlangApi["TextEditList"]>;
  StringList: new () => ReturnType<SlangApi["StringList"]>;
  createLanguageServer(): ReturnType<SlangApi["createLanguageServer"]>;
  getVersionString(): string;
}): SlangApi {
  return {
    FS: module.FS,
    TextEditList: () => new module.TextEditList(),
    StringList: () => new module.StringList(),
    createLanguageServer: () => module.createLanguageServer(),
    getVersionString: () => module.getVersionString(),
  };
}
