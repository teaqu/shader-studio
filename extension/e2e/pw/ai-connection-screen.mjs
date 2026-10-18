import { expect } from '@playwright/test';

export async function findConnectionScreen(vscode) {
  let screen;
  await expect.poll(async () => {
    for (const frame of vscode.window.frames()) {
      try {
        if (await frame.getByRole('heading', { name: 'AI connection', exact: true }).isVisible()) {
          screen = frame;
          return true;
        }
      } catch (error) {
        if (!frame.isDetached()) {
          throw error;
        }
      }
    }
    return false;
  }).toBe(true);
  return screen;
}
