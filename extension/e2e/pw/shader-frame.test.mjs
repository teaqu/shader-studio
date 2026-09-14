import test from 'node:test';
import assert from 'node:assert/strict';
import { findShownAppFrame } from './shader-frame.mjs';

const workbench = { name: 'workbench', parentFrame: () => null };

function element(visible) {
  return { isVisible: async () => visible };
}

/** A VS Code webview: the workbench embeds an outer webview iframe, which
 *  embeds the frame running the app. */
function webview(name, { panelVisible, canvasVisible = true, detached = false }) {
  const outer = {
    name: `${name}-outer`,
    parentFrame: () => workbench,
    frameElement: async () => element(panelVisible),
    locator: () => ({ first: () => element(false) }),
  };
  const app = {
    name,
    parentFrame: () => outer,
    // Inside its own webview document the app frame always looks visible.
    frameElement: async () => element(true),
    locator: () => {
      if (detached) {
        throw new Error('Frame was detached');
      }
      return { first: () => element(canvasVisible) };
    },
  };
  return [outer, app];
}

test('findShownAppFrame skips a retained hidden panel listed before the shown one', async () => {
  const [hiddenOuter, hiddenApp] = webview('hidden', { panelVisible: false });
  const [shownOuter, shownApp] = webview('shown', { panelVisible: true });

  const frame = await findShownAppFrame([workbench, hiddenOuter, hiddenApp, shownOuter, shownApp]);

  assert.equal(frame, shownApp);
});

test('findShownAppFrame finds nothing while every app panel is hidden', async () => {
  const [outer, app] = webview('hidden', { panelVisible: false });

  assert.equal(await findShownAppFrame([workbench, outer, app]), null);
});

test('findShownAppFrame ignores shown frames without a visible canvas', async () => {
  const [outer, app] = webview('loading', { panelVisible: true, canvasVisible: false });

  assert.equal(await findShownAppFrame([workbench, outer, app]), null);
});

test('findShownAppFrame skips frames detached mid-scan', async () => {
  const [detachedOuter, detachedApp] = webview('detached', { panelVisible: true, detached: true });
  const [shownOuter, shownApp] = webview('shown', { panelVisible: true });

  const frame = await findShownAppFrame([detachedOuter, detachedApp, shownOuter, shownApp]);

  assert.equal(frame, shownApp);
});

test('findShownAppFrame treats a frame whose embedding element vanished as not shown', async () => {
  const [outer, app] = webview('closing', { panelVisible: true });
  outer.frameElement = async () => {
    throw new Error('Frame has been detached');
  };
  const [shownOuter, shownApp] = webview('shown', { panelVisible: true });

  assert.equal(await findShownAppFrame([outer, app, shownOuter, shownApp]), shownApp);
});
