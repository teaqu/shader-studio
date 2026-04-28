import type { ShaderConfig } from "@shader-studio/types";
import type { Transport } from "../transport/MessageTransport";

export interface PersistConfigParams {
  config: ShaderConfig;
  shaderPath: string;
  skipRefresh?: boolean;
}

export function stripResolvedPath(config: ShaderConfig): { text: string; clean: ShaderConfig } {
  const text = JSON.stringify(
    config,
    (key, value) => (key === "resolved_path" ? undefined : value),
    2,
  );
  return { text, clean: JSON.parse(text) as ShaderConfig };
}

export function persistConfig(transport: Transport, params: PersistConfigParams): void {
  const { text, clean } = stripResolvedPath(params.config);
  transport.postMessage({
    type: "updateConfig",
    payload: {
      config: clean,
      text,
      shaderPath: params.shaderPath,
      skipRefresh: params.skipRefresh,
    },
  });
}
