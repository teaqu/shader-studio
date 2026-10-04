import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import CaptureError from '../../../lib/components/config/CaptureError.svelte';

afterEach(cleanup);

it('announces the capture failure and updates its explanation', async () => {
  const view = render(CaptureError, { title: 'Screen failed', message: 'Permission denied' });
  expect(view.getByRole('alert').textContent).toContain('Screen failed');
  expect(view.getByRole('alert').textContent).toContain('Permission denied');
  await view.rerender({ title: 'Audio failed', message: 'Device disconnected' });
  expect(view.getByRole('alert').textContent).toContain('Audio failed');
  expect(view.getByRole('alert').textContent).toContain('Device disconnected');
  expect(view.getByRole('alert').textContent).not.toContain('Permission denied');
});
