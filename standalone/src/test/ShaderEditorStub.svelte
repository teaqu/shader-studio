<script lang="ts">
  interface Props {
    isVisible: boolean;
    shaderCode: string;
    shaderPath: string;
    vimMode: boolean;
    errors: string[];
    activeBufferName: string;
    commonPath?: string;
    commonSource?: string;
    onCodeChange: (code: string) => void;
    onBufferSwitch: (bufferName: string) => void;
    onCursorChange?: (line: number, content: string, buffer: string) => void;
    onManualCompile?: () => void;
  }

  let {
    isVisible,
    shaderCode,
    shaderPath,
    vimMode,
    errors = [],
    activeBufferName,
    commonPath = undefined,
    commonSource = undefined,
    onCodeChange,
    onBufferSwitch,
    onCursorChange = () => {},
    onManualCompile = () => {},
  }: Props = $props();
</script>

<div
  data-testid="shader-editor"
  data-visible={isVisible}
  data-code={shaderCode}
  data-path={shaderPath}
  data-vim={vimMode}
  data-errors={errors.join('|')}
  data-buffer={activeBufferName}
  data-common-path={commonPath}
  data-common-source={commonSource}
></div>
<button type="button" onclick={() => onCodeChange('edited source')}>Edit</button>
<button type="button" onclick={() => onBufferSwitch('Buffer B')}>Switch buffer</button>
<button type="button" onclick={() => onManualCompile()}>Manual compile</button>

<button type="button" onclick={() => onCursorChange(2, "shade = 0.375;", activeBufferName)}>Select line</button>
