import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { isWithinDirectory, sourceForDocument } from './platform.mjs';

test('installed extension containment respects Windows drives, case and separators', () => {
  assert.equal(isWithinDirectory('C:\\Profile\\extensions', 'c:\\profile\\extensions\\teaqu.shader-studio', path.win32), true);
  for (const file of ['C:\\Profile\\extensions-other\\extension', 'C:\\Profile\\extension', 'D:\\Profile\\extensions\\extension', 'C:\\Profile\\extensions']) {
    assert.equal(isWithinDirectory('C:\\Profile\\extensions', file, path.win32), false, file);
  }
  assert.equal(isWithinDirectory('\\\\server\\share\\extensions', '\\\\server\\share\\extensions\\extension', path.win32), true);
});

test('installed extension containment preserves POSIX case and rejects traversal', () => {
  assert.equal(isWithinDirectory('/profile/extensions', '/profile/extensions/extension', path.posix), true);
  for (const file of ['/Profile/extensions/extension', '/profile/extensions-other/extension', '/profile/extensions/../outside', '/profile/extensions']) {
    assert.equal(isWithinDirectory('/profile/extensions', file, path.posix), false, file);
  }
});

test('pasted source preserves content and the document EOL', () => {
  const source = '\n  let colour = "緑";\r\nreturn colour;\n';
  assert.equal(sourceForDocument(source, 1), '\n  let colour = "緑";\nreturn colour;\n');
  assert.equal(sourceForDocument(source, 2), '\r\n  let colour = "緑";\r\nreturn colour;\r\n');
  assert.equal(sourceForDocument('no newline\rinside', 2), 'no newline\rinside');
  assert.equal(sourceForDocument('', 1), '');
});
