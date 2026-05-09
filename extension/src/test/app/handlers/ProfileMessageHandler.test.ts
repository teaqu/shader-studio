import * as assert from 'assert';
import * as sinon from 'sinon';
import type { ProfileIndex, ProfileData } from '@shader-studio/types';

const proxyquire = require('proxyquire');

suite('ProfileMessageHandler Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let mockFileService: {
    readIndex: sinon.SinonStub;
    readProfile: sinon.SinonStub;
    writeProfile: sinon.SinonStub;
    writeIndex: sinon.SinonStub;
    deleteProfile: sinon.SinonStub;
  };
  let ProfileMessageHandler: new (
    fileService: typeof mockFileService,
  ) => import('../../../app/handlers/ProfileMessageHandler').ProfileMessageHandler;
  let respondFn: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();

    mockFileService = {
      readIndex: sandbox.stub(),
      readProfile: sandbox.stub(),
      writeProfile: sandbox.stub(),
      writeIndex: sandbox.stub(),
      deleteProfile: sandbox.stub(),
    };

    respondFn = sandbox.stub();

    const mod = proxyquire('../../../app/handlers/ProfileMessageHandler', {});
    ProfileMessageHandler = mod.ProfileMessageHandler;
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('profile:readIndex', () => {
    test('calls readIndex and responds with index data', async () => {
      const index: ProfileIndex = { active: 'default', order: [{ id: 'default', name: 'Default' }] };
      mockFileService.readIndex.resolves(index);
      const handler = new ProfileMessageHandler(mockFileService as any);

      const result = await handler.handle({ type: 'profile:readIndex', requestId: 'req-1' }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(mockFileService.readIndex.calledOnce);
      assert.ok(respondFn.calledOnce);
      assert.deepStrictEqual(respondFn.firstCall.args[0], {
        type: 'profile:indexData',
        requestId: 'req-1',
        index,
      });
    });

    test('responds with null index when readIndex returns null', async () => {
      mockFileService.readIndex.resolves(null);
      const handler = new ProfileMessageHandler(mockFileService as any);

      const result = await handler.handle({ type: 'profile:readIndex', requestId: 'req-2' }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(respondFn.calledOnce);
      assert.deepStrictEqual(respondFn.firstCall.args[0], {
        type: 'profile:indexData',
        requestId: 'req-2',
        index: null,
      });
    });
  });

  suite('profile:readProfile', () => {
    test('calls readProfile with id and responds with profile data', async () => {
      const data: ProfileData = {
        theme: 'dark',
        layout: null,
        configPanel: { isVisible: false },
        debugPanel: {
          isVisible: false,
          isVariableInspectorEnabled: false,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: true,
        },
        performancePanel: { isVisible: false },
      };
      mockFileService.readProfile.resolves(data);
      const handler = new ProfileMessageHandler(mockFileService as any);

      const result = await handler.handle({ type: 'profile:readProfile', requestId: 'req-3', id: 'default' }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(mockFileService.readProfile.calledOnceWith('default'));
      assert.ok(respondFn.calledOnce);
      assert.deepStrictEqual(respondFn.firstCall.args[0], {
        type: 'profile:profileData',
        requestId: 'req-3',
        data,
      });
    });

    test('responds with null data when readProfile returns null', async () => {
      mockFileService.readProfile.resolves(null);
      const handler = new ProfileMessageHandler(mockFileService as any);

      const result = await handler.handle({ type: 'profile:readProfile', requestId: 'req-4', id: 'missing' }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(respondFn.calledOnce);
      assert.deepStrictEqual(respondFn.firstCall.args[0], {
        type: 'profile:profileData',
        requestId: 'req-4',
        data: null,
      });
    });
  });

  suite('profile:writeProfile', () => {
    test('calls writeProfile with id and data, returns true without calling respondFn', async () => {
      mockFileService.writeProfile.resolves();
      const handler = new ProfileMessageHandler(mockFileService as any);
      const data: ProfileData = {
        theme: 'light',
        layout: null,
        configPanel: { isVisible: true },
        debugPanel: {
          isVisible: false,
          isVariableInspectorEnabled: false,
          isInlineRenderingEnabled: true,
          isPixelInspectorEnabled: true,
        },
        performancePanel: { isVisible: false },
      };

      const result = await handler.handle({ type: 'profile:writeProfile', id: 'default', data }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(mockFileService.writeProfile.calledOnceWith('default', data));
      assert.ok(respondFn.notCalled);
    });
  });

  suite('profile:writeIndex', () => {
    test('calls writeIndex with index, returns true without calling respondFn', async () => {
      mockFileService.writeIndex.resolves();
      const handler = new ProfileMessageHandler(mockFileService as any);
      const index: ProfileIndex = { active: 'default', order: [{ id: 'default', name: 'Default' }] };

      const result = await handler.handle({ type: 'profile:writeIndex', index }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(mockFileService.writeIndex.calledOnceWith(index));
      assert.ok(respondFn.notCalled);
    });
  });

  suite('profile:deleteProfile', () => {
    test('calls deleteProfile with id, returns true without calling respondFn', async () => {
      mockFileService.deleteProfile.resolves();
      const handler = new ProfileMessageHandler(mockFileService as any);

      const result = await handler.handle({ type: 'profile:deleteProfile', id: 'wide-editor' }, respondFn);

      assert.strictEqual(result, true);
      assert.ok(mockFileService.deleteProfile.calledOnceWith('wide-editor'));
      assert.ok(respondFn.notCalled);
    });
  });

  suite('unknown message type', () => {
    test('returns false for unhandled message types', async () => {
      const handler = new ProfileMessageHandler(mockFileService as any);

      const result = await handler.handle({ type: 'some:unknownType' }, respondFn);

      assert.strictEqual(result, false);
      assert.ok(respondFn.notCalled);
    });
  });
});
