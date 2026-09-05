<script lang="ts">
  import type { Transport } from "../transport/MessageTransport";
  import type { ShaderConfig, SlangSourceModule } from "@shader-studio/types";
  import ShaderEditor from "./ShaderEditor.svelte";

  type CompileMode = "hot" | "save" | "manual";

  interface Props {
    isVisible?: boolean;
    shaderCode?: string;
    shaderPath?: string;
    transport: Transport;
    onCodeChange?: (code: string) => void;
    vimMode?: boolean;
    topInset?: number;
    bottomInset?: number;
    bufferNames?: string[];
    activeBufferName?: string;
    onBufferSwitch?: (bufferName: string) => void;
    errors?: string[];
    compileMode?: CompileMode;
    config?: ShaderConfig | null;
    customUniformInfo?: { name: string; type: string }[];
    slangModules?: SlangSourceModule[];
    onCursorChange?: (line: number, lineContent: string, bufferName: string) => void;
  }

  let {
    isVisible = false,
    shaderCode = "",
    shaderPath = "",
    transport,
    onCodeChange = () => {},
    vimMode = false,
    topInset = 0,
    bottomInset = 0,
    bufferNames = ["Image"],
    activeBufferName = "Image",
    onBufferSwitch = (_bufferName: string) => {},
    errors = [],
    compileMode = "hot",
    config = null,
    customUniformInfo = [],
    slangModules = [],
    onCursorChange = (_line: number, _lineContent: string, _bufferName: string) => {},
  }: Props = $props();
</script>

<ShaderEditor
  {isVisible}
  {shaderCode}
  {shaderPath}
  {transport}
  {onCodeChange}
  {vimMode}
  {topInset}
  {bottomInset}
  {bufferNames}
  {activeBufferName}
  {onBufferSwitch}
  {errors}
  {compileMode}
  {config}
  {customUniformInfo}
  {slangModules}
  {onCursorChange}
  displayMode="overlay"
/>
