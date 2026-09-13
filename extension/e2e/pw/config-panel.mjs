/** Opens configuration through the control that is reachable at this width. */
export async function openConfigPanel(frame) {
  const toolbarButton = frame.locator('.collapse-config[aria-label="Toggle config panel"]');
  if (await toolbarButton.isVisible()) {
    await toolbarButton.click();
    return;
  }

  await frame.getByLabel('Open options menu').click();
  await frame.locator('.options-menu-portal').getByLabel('Toggle config panel').click();
}
