import { test, expect, workspacePath } from './fixtures.mjs';
import { join } from 'node:path';

const fixturePath = join(workspacePath, 'language-servers');
// vscode.DocumentHighlightKind.Write
const vscodeWriteHighlight = 2;

async function languageSnapshot(vscodeFixture, filePath, language) {
  return vscodeFixture.evaluateInHost(async (vscode, targetPath, expectedLanguage) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    if (document.languageId !== expectedLanguage) {
      throw new Error(`Expected ${targetPath} to use ${expectedLanguage}, got ${document.languageId}`);
    }
    const source = document.getText();
    const position = (needle, occurrence = 0, offset = 1) => {
      let index = -1;
      for (let count = 0; count <= occurrence; count++) {
        index = source.indexOf(needle, index + 1);
      }
      if (index < 0) {
        throw new Error(`Missing ${needle} occurrence ${occurrence} in ${targetPath}`);
      }
      return document.positionAt(index + offset);
    };
    const markdown = (value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map(markdown).join('\n');
      }
      return value?.value ?? '';
    };
    const hover = async (needle, occurrence = 0) => {
      const values = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, position(needle, occurrence));
      return (values ?? []).flatMap((item) => item.contents.map(markdown)).join('\n');
    };
    const completions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      document.uri,
      document.positionAt(source.length),
      undefined,
      1_000,
    );
    const call = expectedLanguage === 'glsl' ? 'shade(literalColor.r)' : 'shade(remainder)';
    const signature = await vscode.commands.executeCommand(
      'vscode.executeSignatureHelpProvider',
      document.uri,
      position(call, 0, call.indexOf('(') + 2),
      '(',
    );
    const definition = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      document.uri,
      position('twice(value)', 0),
    );
    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
    const colors = await vscode.commands.executeCommand('vscode.executeDocumentColorProvider', document.uri);
    const colorPresentations = colors?.[0]
      ? await vscode.commands.executeCommand('vscode.executeColorPresentationProvider', colors[0].color, {
        uri: document.uri,
        range: colors[0].range,
      })
      : [];
    const completionItems = completions?.items ?? [];
    const completionDocs = {};
    const documentedCompletions = expectedLanguage === 'glsl'
      ? new Set(['texture'])
      : new Set(['normalize', 'fmod', 'sampleIChannel0']);
    for (const item of completionItems) {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      if (documentedCompletions.has(label)) {
        completionDocs[label] = [completionDocs[label], markdown(item.documentation)].filter(Boolean).join('\n');
      }
    }
    return {
      labels: completionItems.map((item) => typeof item.label === 'string' ? item.label : item.label.label),
      completionDocs,
      completionEntries: completionItems.filter((item) => (
        (typeof item.label === 'string' ? item.label : item.label.label) === 'normalize'
      )).map((item) => ({
        label: typeof item.label === 'string' ? item.label : item.label.label,
        detail: item.detail ?? '',
        documentation: markdown(item.documentation),
      })),
      builtinHover: await hover('iResolution'),
      intrinsicHover: await hover(expectedLanguage === 'glsl' ? 'texture(iChannel0' : 'fmod('),
      channelHover: await hover(expectedLanguage === 'glsl' ? 'iChannel0' : 'sampleIChannel0'),
      hookHover: await hover('mainImage'),
      coordinateHover: await hover('pixelPosition'),
      definitions: (definition ?? []).map((item) => ({ path: item.uri.fsPath, line: item.range.start.line })),
      signatures: signature?.signatures.map((item) => item.label) ?? [],
      symbols: (symbols ?? []).map((item) => item.name),
      colors: (colors ?? []).map((item) => ({
        red: item.color.red,
        green: item.color.green,
        blue: item.color.blue,
        alpha: item.color.alpha,
      })),
      colorPresentations: (colorPresentations ?? []).map((item) => item.label),
    };
  }, filePath, language);
}

async function navigationSnapshot(vscodeFixture, filePath) {
  return vscodeFixture.evaluateInHost(async (vscode, targetPath) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const source = document.getText();
    const position = (needle, occurrence = 0, offset = 1) => {
      let index = -1;
      for (let count = 0; count <= occurrence; count++) {
        index = source.indexOf(needle, index + 1);
      }
      if (index < 0) {
        throw new Error(`Missing ${needle} occurrence ${occurrence} in ${targetPath}`);
      }
      return document.positionAt(index + offset);
    };
    const references = await vscode.commands.executeCommand(
      'vscode.executeReferenceProvider',
      document.uri,
      position('shade(float value)'),
    );
    const highlights = await vscode.commands.executeCommand(
      'vscode.executeDocumentHighlights',
      document.uri,
      position('literalColor', 1),
    );
    const renameEdit = await vscode.commands.executeCommand(
      'vscode.executeDocumentRenameProvider',
      document.uri,
      position('uv = pixelPosition'),
      'screenUv',
    );
    const describeEdit = (edit) => (edit?.entries() ?? []).map(([uri, edits]) => ({
      path: uri.fsPath,
      edits: edits.map((item) => ({ line: item.range.start.line, newText: item.newText })),
    }));
    let includedRenameFailed = false;
    try {
      const includedRename = await vscode.commands.executeCommand(
        'vscode.executeDocumentRenameProvider',
        document.uri,
        position('twice(value)'),
        'doubled',
      );
      includedRenameFailed = describeEdit(includedRename).length === 0;
    } catch {
      // VS Code surfaces a declined rename as a thrown error.
      includedRenameFailed = true;
    }
    return {
      references: (references ?? []).map((item) => ({ path: item.uri.fsPath, line: item.range.start.line })),
      highlights: (highlights ?? []).map((item) => ({ line: item.range.start.line, kind: item.kind })),
      rename: describeEdit(renameEdit),
      includedRenameFailed,
    };
  }, filePath);
}

async function stageSnapshot(vscodeFixture, filePath, expectations) {
  return vscodeFixture.evaluateInHost(async (vscode, targetPath, needles) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const source = document.getText();
    const hover = async (needle) => {
      const offset = source.indexOf(needle);
      const values = await vscode.commands.executeCommand(
        'vscode.executeHoverProvider',
        document.uri,
        document.positionAt(offset + 1),
      );
      return (values ?? []).flatMap((item) => item.contents.map((content) => (
        typeof content === 'string' ? content : content.value
      ))).join('\n');
    };
    const completions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      document.uri,
      document.positionAt(source.length - 2),
      undefined,
      1_000,
    );
    const completionDocs = {};
    for (const item of completions?.items ?? []) {
      const label = typeof item.label === 'string' ? item.label : item.label.label;
      const documentation = typeof item.documentation === 'string' ? item.documentation : item.documentation?.value ?? '';
      if (needles.includes(label)) {
        completionDocs[label] = [completionDocs[label], documentation].filter(Boolean).join('\n');
      }
    }
    return {
      hovers: Object.fromEntries(await Promise.all(needles.map(async (needle) => [needle, await hover(needle)]))),
      labels: (completions?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label),
      completionDocs,
    };
  }, filePath, expectations);
}

async function openDiagnosticDocument(vscodeFixture, filePath) {
  return vscodeFixture.evaluateInHost(async (vscode, targetPath) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      document.uri,
      new vscode.Position(0, 0),
    );
    return {
      uri: document.uri.toString(),
      diagnostics: vscode.languages.getDiagnostics(document.uri).map((item) => ({
        message: item.message,
        source: item.source,
        code: item.code,
      })),
    };
  }, filePath);
}

async function diagnosticSnapshot(vscodeFixture, uri, message) {
  return vscodeFixture.evaluateInHost(async (vscode, documentUri, expected) => {
    const found = vscode.languages.getDiagnostics(vscode.Uri.parse(documentUri))
      .find((item) => item.message.toLocaleLowerCase().includes(expected.toLocaleLowerCase()));
    return found ? { message: found.message, source: found.source, code: found.code } : null;
  }, uri, message);
}

async function waitForDiagnostic(vscodeFixture, uri, message, present = true) {
  let diagnostic = null;
  await expect.poll(async () => {
    diagnostic = await diagnosticSnapshot(vscodeFixture, uri, message);
    return Boolean(diagnostic);
  }, {
    timeout: 15_000,
    intervals: [100],
    message: `expected diagnostic ${JSON.stringify(message)} to be ${present ? 'published' : 'cleared'}`,
  }).toBe(present);
  return diagnostic;
}

async function replaceDiagnosticDocument(vscodeFixture, uri, content) {
  await vscodeFixture.evaluateInHost(async (vscode, documentUri, source) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
    const edit = new vscode.WorkspaceEdit();
    const end = document.positionAt(document.getText().length);
    edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), source);
    await vscode.workspace.applyEdit(edit);
  }, uri, content);
}

test.use({ vscodeKey: 'language-servers' });

test.describe('Shader language servers in VS Code', () => {
  test.beforeAll(async ({ vscode }) => {
    expect(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured').toBeTruthy();
    await vscode.evaluateInHost(async (vscode) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    });
  });

  test('provides the complete GLSL authoring feature set', async ({ vscode }) => {
    const result = await languageSnapshot(vscode, join(fixturePath, 'image.glsl'), 'glsl');

    expect(result.labels.includes('texture')).toBeTruthy();
    expect(result.labels.includes('iResolution')).toBeTruthy();
    expect(result.labels.includes('iChannel0')).toBeTruthy();
    expect(result.labels.includes('shade')).toBeTruthy();
    expect(result.labels.includes('twice')).toBeTruthy();
    expect(!result.labels.includes('mainVertex')).toBeTruthy();
    expect(result.completionDocs.texture).toMatch(/texture|samples/i);
    expect(result.builtinHover).toMatch(/Canvas dimensions/);
    expect(result.intrinsicHover).toMatch(/texture coordinate|texture/i);
    expect(result.channelHover).toMatch(/input channel/i);
    expect(result.hookHover).toMatch(/fragment entry point/i);
    expect(result.coordinateHover).toMatch(/lower-left/i);
    expect(result.definitions.some((item) => item.path.endsWith('common.glsl') && item.line === 0)).toBeTruthy();
    expect(result.signatures.some((item) => item.includes('shade'))).toBeTruthy();
    expect(result.symbols.includes('shade')).toBeTruthy();
    expect(result.symbols.includes('mainImage')).toBeTruthy();
    expect(result.colors[0]).toEqual({ red: 1, green: 0.5, blue: 0, alpha: 1 });
    expect(result.colorPresentations.some((item) => item.includes('vec4')), JSON.stringify(result.colorPresentations)).toBeTruthy();
  });

  test('resolves GLSL references, highlights, and renames', async ({ vscode }) => {
    const result = await navigationSnapshot(vscode, join(fixturePath, 'image.glsl'));

    // `shade` is declared on line 3 and called on line 10.
    expect(result.references.every((item) => item.path.endsWith('image.glsl'))).toBeTruthy();
    expect(result.references.map((item) => item.line).sort((a, b) => a - b)).toEqual([2, 9]);

    // `literalColor` is written on line 8 and read on line 10.
    expect(result.highlights.map((item) => item.line).sort((a, b) => a - b)).toEqual([7, 9]);
    expect(result.highlights.some((item) => item.kind === vscodeWriteHighlight)).toBeTruthy();

    // Renaming `uv` rewrites its declaration and its single use.
    expect(result.rename).toHaveLength(1);
    expect(result.rename[0].path.endsWith('image.glsl')).toBeTruthy();
    expect(result.rename[0].edits.map((item) => item.line).sort((a, b) => a - b)).toEqual([8, 9]);
    expect(result.rename[0].edits.every((item) => item.newText === 'screenUv')).toBeTruthy();

    // `twice` is owned by common.glsl, so renaming it from here declines.
    expect(result.includedRenameFailed).toBeTruthy();
  });

  test('provides the complete Slang authoring feature set through bundled WASM', async ({ vscode }) => {
    const result = await languageSnapshot(vscode, join(fixturePath, 'image.slang'), 'slang');

    for (const label of ['normalize', 'fmod', 'sampleIChannel0', 'iResolution', 'iChannel0', 'shade', 'twice']) {
      expect(result.labels.includes(label), `Missing Slang completion ${label}`).toBeTruthy();
    }
    expect(
      result.completionDocs.normalize,
      JSON.stringify(result.completionEntries.filter((item) => item.label === 'normalize')),
    ).toMatch(/unit length/i);
    expect(result.completionDocs.fmod).toMatch(/remainder/i);
    expect(result.completionDocs.sampleIChannel0).toMatch(/input channel 0/i);
    for (const stageOnly of ['mainVertex', 'numthreads', 'SV_DispatchThreadID', 'writeOutput']) {
      expect(!result.labels.includes(stageOnly), `Unexpected fragment completion ${stageOnly}`).toBeTruthy();
    }
    expect(result.builtinHover).toMatch(/Canvas dimensions/);
    expect(result.intrinsicHover).toMatch(/remainder/i);
    expect(result.channelHover).toMatch(/input channel/i);
    expect(result.hookHover).toMatch(/fragment entry point/i);
    expect(result.coordinateHover).toMatch(/lower-left/i);
    expect(result.definitions.some((item) => item.path.endsWith('palette.slang')), JSON.stringify(result.definitions)).toBeTruthy();
    expect(result.signatures.some((item) => item.includes('shade'))).toBeTruthy();
    expect(result.symbols.includes('shade')).toBeTruthy();
    expect(result.symbols.includes('mainImage')).toBeTruthy();
    expect(result.colors[0]).toEqual({ red: 1, green: 0.5, blue: 0, alpha: 1 });
    expect(result.colorPresentations.some((item) => item.includes('float4')), JSON.stringify(result.colorPresentations)).toBeTruthy();
  });

  test('provides vertex and compute contracts only in their configured stages', async ({ vscode }) => {
    const glslVertex = await stageSnapshot(vscode, join(fixturePath, 'vertex.glsl'), ['mainVertex', 'deformed', 'surfaceNormal', 'textureUv']);
    expect(glslVertex.hovers.mainVertex).toMatch(/vertex hook/i);
    expect(glslVertex.hovers.deformed).toMatch(/vertex position/i);
    expect(glslVertex.hovers.surfaceNormal).toMatch(/vertex normal/i);
    expect(glslVertex.hovers.textureUv).toMatch(/texture coordinate/i);
    expect(!glslVertex.labels.includes('mainImage')).toBeTruthy();

    const slangVertex = await stageSnapshot(vscode, join(fixturePath, 'vertex.slang'), ['mainVertex', 'deformed', 'surfaceNormal', 'textureUv']);
    expect(slangVertex.hovers.mainVertex).toMatch(/vertex hook/i);
    expect(slangVertex.hovers.deformed).toMatch(/vertex position/i);
    expect(slangVertex.hovers.surfaceNormal).toMatch(/vertex normal/i);
    expect(slangVertex.hovers.textureUv).toMatch(/texture coordinate/i);
    expect(!slangVertex.labels.includes('mainImage')).toBeTruthy();
    expect(!slangVertex.labels.includes('writeOutput')).toBeTruthy();

    const compute = await stageSnapshot(vscode, join(fixturePath, 'compute.slang'), ['numthreads', 'SV_DispatchThreadID', 'iDispatch', 'writeOutput']);
    expect(compute.hovers.numthreads).toMatch(/workgroup/i);
    expect(compute.hovers.SV_DispatchThreadID).toMatch(/Global dispatch/i);
    expect(compute.hovers.iDispatch).toMatch(/repetition index/i);
    expect(compute.hovers.writeOutput).toMatch(/compute pass output texture/i);
    for (const label of ['numthreads', 'SV_DispatchThreadID', 'iDispatch', 'writeOutput']) {
      expect(compute.labels.includes(label), `Missing compute completion ${label}`).toBeTruthy();
    }
    expect(!compute.labels.includes('mainImage')).toBeTruthy();
    expect(!compute.labels.includes('mainVertex')).toBeTruthy();
  });

  test('publishes GLSL parser and Slang compiler diagnostics', async ({ vscode }) => {
    const glslDocument = await openDiagnosticDocument(vscode, join(fixturePath, 'diagnostic.glsl'));
    const glslUri = glslDocument.uri;
    expect(glslDocument.diagnostics.length > 0, JSON.stringify(glslDocument.diagnostics)).toBeTruthy();
    const glsl = await waitForDiagnostic(vscode, glslUri, 'include');
    expect(glsl, JSON.stringify(glslDocument.diagnostics)).toBeTruthy();
    expect(glsl.source).toMatch(/shader-studio-glsl/i);
    await replaceDiagnosticDocument(vscode, glslUri, 'void mainImage(out vec4 color, in vec2 position) { color = vec4(position, 0.0, 1.0); }');
    await waitForDiagnostic(vscode, glslUri, 'include', false);

    const slangDocument = await openDiagnosticDocument(vscode, join(fixturePath, 'diagnostic.slang'));
    const slangUri = slangDocument.uri;
    const slang = await waitForDiagnostic(vscode, slangUri, 'undefined identifier');
    expect(slang, JSON.stringify(slangDocument.diagnostics)).toBeTruthy();
    expect(slang.source).toBe('shader-studio-slang-compiler');
  });

});
