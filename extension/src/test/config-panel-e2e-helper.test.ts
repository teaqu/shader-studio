import * as assert from 'assert';
import * as path from 'path';
import { pathToFileURL } from 'url';

interface Locator {
  isVisible?(): Promise<boolean>;
  click(): Promise<void>;
  getByLabel?(label: string): Locator;
}

interface Frame {
  locator(selector: string): Locator;
  getByLabel(label: string): Locator;
}

suite('Responsive config-panel E2E helper', () => {
  let openConfigPanel: (frame: Frame) => Promise<void>;

  suiteSetup(async () => {
    const url = pathToFileURL(path.resolve(__dirname, '../../e2e/pw/config-panel.mjs')).href;
    ({ openConfigPanel } = await import(url));
  });

  test('uses the visible toolbar control on a wide menu bar', async () => {
    let toolbarClicks = 0;
    let optionsClicks = 0;
    const frame: Frame = {
      locator: (selector) => {
        assert.strictEqual(selector, '.collapse-config[aria-label="Toggle config panel"]');
        return {
          isVisible: async () => true,
          click: async () => {
            toolbarClicks += 1;
          },
        };
      },
      getByLabel: () => ({ click: async () => {
        optionsClicks += 1;
      } }),
    };

    await openConfigPanel(frame);

    assert.strictEqual(toolbarClicks, 1);
    assert.strictEqual(optionsClicks, 0);
  });

  test('uses Options when the toolbar config control is hidden on a narrow menu bar', async () => {
    let toolbarClicks = 0;
    let optionsClicks = 0;
    let configClicks = 0;
    const frame: Frame = {
      locator: (selector) => {
        if (selector === '.collapse-config[aria-label="Toggle config panel"]') {
          return {
            isVisible: async () => false,
            click: async () => {
              toolbarClicks += 1;
            },
          };
        }
        assert.strictEqual(selector, '.options-menu-portal');
        return {
          click: async () => {
            throw new Error('the Options portal itself is not clickable');
          },
          getByLabel: (label) => {
            assert.strictEqual(label, 'Toggle config panel');
            return { click: async () => {
              configClicks += 1;
            } };
          },
        };
      },
      getByLabel: (label) => {
        assert.strictEqual(label, 'Open options menu');
        return { click: async () => {
          optionsClicks += 1;
        } };
      },
    };

    await openConfigPanel(frame);

    assert.strictEqual(toolbarClicks, 0);
    assert.strictEqual(optionsClicks, 1);
    assert.strictEqual(configClicks, 1);
  });
});
