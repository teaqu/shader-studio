import { expect, it } from 'vitest';
import { shaderAuthoringEnvironment, shaderDocumentUri } from '../../lib/editor/shaderAuthoringEnvironment';
import type { ShaderEditorProps } from '../../lib/editor/ShaderEditorProps';
const transport = {} as ShaderEditorProps['transport'];
it('encodes document paths and excludes non-shader documents', () => {
  expect(shaderDocumentUri('/my folder/a#b.glsl')).toBe('file:///my%20folder/a%23b.glsl');
  expect(shaderDocumentUri('Image.glsl')).toBe('file:///Image.glsl');
  expect(shaderAuthoringEnvironment({ transport, shaderPath: '/config.json' }, 1, null)).toBeNull();
});
it('builds default stage context with valid uniforms and shared common source', () => {
  const environment = shaderAuthoringEnvironment({ transport, shaderPath: '/a.glsl', customUniformInfo: [{ name: 'yes', type: 'float' }, { name: 'no', type: 'invalid' }] }, 5, { path: '/common.glsl', text: 'float common;', version: 3 });
  expect(environment).toMatchObject({ documentUri: 'file:///a.glsl', languageId: 'glsl', generation: 5, passName: 'Image', stage: 'fragment', customUniforms: [{ name: 'yes', type: 'float' }], commonFile: { uri: 'file:///common.glsl', version: 3 }, virtualFiles: [] });
});
it('uses configured Common revisions and skips duplicate declarations while editing Common', () => {
  const props = { transport, shaderPath: '/a.wgsl', commonPath: '/c.wgsl', commonSource: 'let c = 1;' };
  expect(shaderAuthoringEnvironment(props, 7, null)?.commonFile?.version).toBe(7);
  expect(shaderAuthoringEnvironment(props, 7, { path: '/c.wgsl', text: '', version: 9 })?.commonFile?.version).toBe(9);
  expect(shaderAuthoringEnvironment({ ...props, activeBufferName: 'Common' }, 7, null)?.commonFile).toBeUndefined();
});
it('includes Slang virtual imports and compute metadata', () => {
  const environment = shaderAuthoringEnvironment({ transport, shaderPath: '/main.slang', shaderCode: '[shader("compute")] [numthreads(1,1,1)] void main(uint3 id: SV_DispatchThreadID) {}', slangModules: [{ path: '/helpers.slang', moduleName: 'helpers', source: 'float h;', ownerPass: 'Image' }], commonPath: '/c.slang', commonSource: '' }, 2, null, path => `uri:${path}`);
  expect(environment).toMatchObject({ documentUri: 'uri:/main.slang', storageWritable: true, virtualFiles: [{ uri: 'uri:/helpers.slang', text: 'float h;', version: 1 }] });
  expect(environment?.commonFile).toBeUndefined();
});
