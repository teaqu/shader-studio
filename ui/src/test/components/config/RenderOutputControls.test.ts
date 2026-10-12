import { render } from '@testing-library/svelte';
import { expect, it, vi } from 'vitest';
import RenderOutputControls from '../../../lib/components/config/RenderOutputControls.svelte';

const props = { language: 'wgsl' as const, format: 'rgba16float' as const,
  maxAttachments: 8, maxBytes: 64, onchange: vi.fn() };
const multiple = 'struct Outputs { @location(0) colour: vec4f, @location(1) normal: vec4f, } @fragment fn shade() -> Outputs { return Outputs(); }';

it('omits output lists for both single and multiple attachments', async () => {
  const view = render(RenderOutputControls, { ...props, source: 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(1); }' });
  expect(view.queryByLabelText('Detected output textures')).toBeNull();
  await view.rerender({ ...props, source: multiple, fragment: 'shade' });
  expect(view.queryByLabelText('Detected output textures')).toBeNull();
  expect(view.queryByText('Output 0 · colour')).toBeNull();
  expect(view.queryByText('Output 1 · normal')).toBeNull();
});

it('keeps attachment limit errors visible', () => {
  const view = render(RenderOutputControls, { ...props, source: multiple, fragment: 'shade', maxAttachments: 1 });
  expect(view.getByRole('alert')).toHaveTextContent('supports up to 1 outputs');
});

it('shows cubemap faces without an attachment list', () => {
  const view = render(RenderOutputControls, { ...props, source: multiple, fragment: 'shade', cubemap: true });
  expect(view.getByText('Six cubemap faces')).toBeVisible();
  expect(view.queryByLabelText('Detected output textures')).toBeNull();
});
