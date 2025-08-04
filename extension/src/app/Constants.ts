/**
 * Constants used throughout the Shader Studio extension
 */
export class Constants {
  static readonly CONFIG_FILE_EXTENSION = ".sha.json";
  static readonly CONFIG_EDITOR_VIEW_TYPE = "shader-studio.configEditor";
  
  static readonly COMMANDS = {
    TOGGLE_CONFIG_VIEW: "shader-studio.toggleConfigView",
    TOGGLE_CONFIG_VIEW_TO_SOURCE: "shader-studio.toggleConfigViewToSource",
    GENERATE_CONFIG: "shader-studio.generateConfig",
    REFRESH_SHADER: "shader-studio.refreshShader",
    OPEN_IN_ELECTRON: "shader-studio.openInElectron"
  } as const;
  
}
