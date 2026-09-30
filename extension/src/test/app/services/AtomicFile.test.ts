import * as assert from 'assert';
import fs = require('fs');
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { writeFileAtomicSync } from '../../../app/services/AtomicFile';

suite('AtomicFile Test Suite', () => {
  let sandbox: sinon.SinonSandbox;
  let directory: string;

  setup(() => {
    sandbox = sinon.createSandbox();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-file-'));
  });

  teardown(() => {
    sandbox.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function errnoError(code: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(code);
    error.code = code;
    return error;
  }

  test('creates a missing file and leaves no temporary file behind', () => {
    const target = path.join(directory, 'shader.sha.json');

    writeFileAtomicSync(target, '{"version":"1"}');

    assert.strictEqual(fs.readFileSync(target, 'utf8'), '{"version":"1"}');
    assert.deepStrictEqual(fs.readdirSync(directory), ['shader.sha.json']);
  });

  test('replaces an existing file without ever opening it for truncation', () => {
    const target = path.join(directory, 'shader.sha.json');
    fs.writeFileSync(target, '{"scriptMaxPollingFps":30}');
    const writes = sandbox.spy(fs, 'writeFileSync');
    const renames = sandbox.spy(fs, 'renameSync');

    writeFileAtomicSync(target, '{"scriptMaxPollingFps":60}');

    assert.ok(writes.getCalls().every((call) => call.args[0] !== target));
    sinon.assert.calledOnce(renames);
    assert.strictEqual(renames.firstCall.args[1], target);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '{"scriptMaxPollingFps":60}');
    assert.deepStrictEqual(fs.readdirSync(directory), ['shader.sha.json']);
  });

  test('keeps the permissions of the file it replaces', function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const target = path.join(directory, 'shader.sha.json');
    fs.writeFileSync(target, '{}');
    fs.chmodSync(target, 0o640);

    writeFileAtomicSync(target, '{"a":1}');

    assert.strictEqual(fs.statSync(target).mode & 0o7777, 0o640);
  });

  test('writes through a symlink and keeps the link', function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const real = path.join(directory, 'real.sha.json');
    const link = path.join(directory, 'link.sha.json');
    fs.writeFileSync(real, '{}');
    fs.symlinkSync(real, link);

    writeFileAtomicSync(link, '{"a":1}');

    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(real, 'utf8'), '{"a":1}');
    assert.deepStrictEqual(fs.readdirSync(directory).sort(), ['link.sha.json', 'real.sha.json']);
  });

  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    test(`writes in place when the rename is refused with ${code}`, () => {
      const target = path.join(directory, 'shader.sha.json');
      fs.writeFileSync(target, '{}');
      sandbox.stub(fs, 'renameSync').throws(errnoError(code));

      writeFileAtomicSync(target, '{"a":1}');

      assert.strictEqual(fs.readFileSync(target, 'utf8'), '{"a":1}');
      assert.deepStrictEqual(fs.readdirSync(directory), ['shader.sha.json']);
    });
  }

  test('rethrows any other rename failure and removes the temporary file', () => {
    const target = path.join(directory, 'shader.sha.json');
    fs.writeFileSync(target, '{}');
    sandbox.stub(fs, 'renameSync').throws(errnoError('EXDEV'));

    assert.throws(() => writeFileAtomicSync(target, '{"a":1}'), /EXDEV/);

    assert.strictEqual(fs.readFileSync(target, 'utf8'), '{}');
    assert.deepStrictEqual(fs.readdirSync(directory), ['shader.sha.json']);
  });

  test('rethrows a failed temporary write and leaves the original untouched', () => {
    const target = path.join(directory, 'shader.sha.json');
    fs.writeFileSync(target, '{}');
    const realWrite = fs.writeFileSync;
    sandbox.stub(fs, 'writeFileSync').callsFake((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
      realWrite(file, data);
      throw errnoError('ENOSPC');
    });

    assert.throws(() => writeFileAtomicSync(target, '{"a":1}'), /ENOSPC/);

    assert.strictEqual(fs.readFileSync(target, 'utf8'), '{}');
    assert.deepStrictEqual(fs.readdirSync(directory), ['shader.sha.json']);
  });

  test('rethrows a failed permission copy and removes the temporary file', () => {
    const target = path.join(directory, 'shader.sha.json');
    fs.writeFileSync(target, '{}');
    sandbox.stub(fs, 'chmodSync').throws(errnoError('EPERM'));

    assert.throws(() => writeFileAtomicSync(target, '{"a":1}'), /EPERM/);

    assert.strictEqual(fs.readFileSync(target, 'utf8'), '{}');
    assert.deepStrictEqual(fs.readdirSync(directory), ['shader.sha.json']);
  });

  test('still reports the original failure when the cleanup also fails', () => {
    const target = path.join(directory, 'shader.sha.json');
    sandbox.stub(fs, 'renameSync').throws(errnoError('EXDEV'));
    sandbox.stub(fs, 'rmSync').throws(errnoError('EBUSY'));

    assert.throws(() => writeFileAtomicSync(target, '{"a":1}'), /EXDEV/);
  });

  test('rethrows when the target directory does not exist', () => {
    const target = path.join(directory, 'missing', 'shader.sha.json');

    assert.throws(() => writeFileAtomicSync(target, '{}'), /ENOENT/);
  });

  test('gives concurrent writes distinct temporary files', () => {
    const target = path.join(directory, 'shader.sha.json');
    const temporaries: string[] = [];
    const realRename = fs.renameSync;
    sandbox.stub(fs, 'renameSync').callsFake((from: fs.PathLike, to: fs.PathLike) => {
      temporaries.push(String(from));
      realRename(from, to);
    });

    writeFileAtomicSync(target, '1');
    writeFileAtomicSync(target, '2');

    assert.strictEqual(new Set(temporaries).size, 2);
    assert.ok(temporaries.every((temporary) => path.dirname(temporary) === directory));
    assert.strictEqual(fs.readFileSync(target, 'utf8'), '2');
  });
});
