<script lang="ts">
  interface Props {
    isVisible: boolean;
    shaderCode: string;
    shaderPath: string;
    vimMode: boolean;
    errors: string[];
    activeBufferName: string;
    onCodeChange: (code: string) => void;
    onBufferSwitch: (bufferName: string) => void;
  }

  let {
    isVisible,
    shaderCode,
    shaderPath,
    vimMode,
    errors = [],
    activeBufferName,
    onCodeChange,
    onBufferSwitch,
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
></div>
<button type="button" onclick={() => onCodeChange('edited source')}>Edit</button>
<button type="button" onclick={() => onBufferSwitch('Buffer B')}>Switch buffer</button>
