<script lang="ts">
  import type { ViewerSession } from '@shader-studio/ui';
  import { onDestroy } from 'svelte';
  interface Props {
    isVisible: boolean;
    shaderCode: string;
    shaderPath: string;
    vimMode: boolean;
    errors: string[];
    activeBufferName: string;
    bufferNames?: string[];
    compileMode?: string;
    config?: ViewerSession['config'];
    customUniformInfo?: ViewerSession['customUniformInfo'];
    slangModules?: ViewerSession['slangModules'];
    commonPath?: string;
    commonSource?: string;
    onCodeChange: (code: string) => void;
    onBufferSwitch: (bufferName: string) => void;
    onCursorChange?: (line: number, content: string, buffer: string) => void;
    onManualCompile?: () => void;
  }

  let {
    isVisible,
    shaderCode = '',
    shaderPath = '',
    vimMode,
    errors = [],
    activeBufferName,
    bufferNames = [],
    compileMode,
    config,
    customUniformInfo = [],
    slangModules = [],
    commonPath = undefined,
    commonSource = undefined,
    onCodeChange = () => {},
    onBufferSwitch,
    onCursorChange = () => {},
    onManualCompile = () => {},
  }: Props = $props();

  // The real editor reads these props while saving its view and pending edits
  // during destruction. Exercise that lifecycle contract in pane tests too.
  onDestroy(() => {
    document.dispatchEvent(new CustomEvent('editor-disposed', {
      detail: { shaderPath, shaderCode, onCodeChange },
    }));
  });
</script>

<div
  data-testid="shader-editor"
  data-buffers={bufferNames.join("|")}
  data-compile-mode={compileMode}
  data-config={JSON.stringify(config)}
  data-uniforms={JSON.stringify(customUniformInfo)}
  data-modules={JSON.stringify(slangModules)}
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
