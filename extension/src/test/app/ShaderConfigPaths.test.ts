import * as assert from 'assert';
import * as sinon from 'sinon';
import { getShaderPathFromConfigPath, isConfigPath } from '../../app/ShaderConfigPaths';

suite('ShaderConfigPaths', () => {
  let sandbox: sinon.SinonSandbox;
  let existsStub: sinon.SinonStub;

  setup(() => {
    sandbox = sinon.createSandbox();
    const fs = require('fs');
    existsStub = sandbox.stub(fs, 'existsSync');
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('isConfigPath', () => {
    test('returns true for .sha.json files', () => {
      assert.strictEqual(isConfigPath('/abs/foo.sha.json'), true);
    });

    test('returns true for uppercase extension', () => {
      assert.strictEqual(isConfigPath('/abs/FOO.SHA.JSON'), true);
    });

    test('returns false for plain .json files', () => {
      assert.strictEqual(isConfigPath('/abs/foo.json'), false);
    });

    test('returns false for .glsl files', () => {
      assert.strictEqual(isConfigPath('/abs/foo.glsl'), false);
    });
  });

  suite('getShaderPathFromConfigPath', () => {
    test('returns .glsl path when .glsl file exists', () => {
      existsStub.withArgs('/abs/foo.glsl').returns(true);
      assert.strictEqual(getShaderPathFromConfigPath('/abs/foo.sha.json'), '/abs/foo.glsl');
    });

    test('falls back to .frag when only .frag exists', () => {
      existsStub.withArgs('/abs/foo.glsl').returns(false);
      existsStub.withArgs('/abs/foo.frag').returns(true);
      assert.strictEqual(getShaderPathFromConfigPath('/abs/foo.sha.json'), '/abs/foo.frag');
    });

    test('prefers .glsl over .frag when both exist', () => {
      existsStub.withArgs('/abs/foo.glsl').returns(true);
      existsStub.withArgs('/abs/foo.frag').returns(true);
      assert.strictEqual(getShaderPathFromConfigPath('/abs/foo.sha.json'), '/abs/foo.glsl');
    });

    test('returns undefined when neither file exists', () => {
      existsStub.returns(false);
      assert.strictEqual(getShaderPathFromConfigPath('/abs/foo.sha.json'), undefined);
    });

    test('returns undefined for non-config paths', () => {
      assert.strictEqual(getShaderPathFromConfigPath('/abs/foo.json'), undefined);
      assert.strictEqual(getShaderPathFromConfigPath('/abs/foo.glsl'), undefined);
    });

    test('handles uppercase .SHA.JSON', () => {
      existsStub.withArgs('/abs/FOO.glsl').returns(true);
      assert.strictEqual(getShaderPathFromConfigPath('/abs/FOO.SHA.JSON'), '/abs/FOO.glsl');
    });
  });
});
