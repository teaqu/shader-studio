import { expect, it } from 'vitest';
import { createNativeFragmentSource } from '../ShaderSourceTemplates';

it.each(['wgsl', 'slang'] as const)('starts a native %s fragment with the animated normalized UV pattern', language => {
  const template = createNativeFragmentSource(language, '', 'Image');
  expect(template.entryPoints).toEqual({ fragment: 'ImageFragment' });
  expect(template.text).toContain('coord / iResolution.xy');
  expect(template.text).toContain('cos(iTime + uv.xyx');
  expect(template.text).toContain('// Normalized pixel coordinates (from 0 to 1)');
  expect(template.text).toContain('// Time varying pixel color');
  expect(template.text).toContain('// Output to screen');
  expect(template.text).not.toContain('ImageVertex');
});
