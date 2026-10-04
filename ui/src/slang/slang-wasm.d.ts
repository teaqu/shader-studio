/** Factory options accepted by the pinned generated Emscripten loader. */
interface SlangModuleOptions {
  wasmBinary?: Uint8Array | ArrayBuffer;
  locateFile?: (path: string, prefix: string) => string;
}

/** Consumers narrow the generated module to their compiler or language-server API. */
export default function createSlangModule(options?: SlangModuleOptions): Promise<unknown>;
