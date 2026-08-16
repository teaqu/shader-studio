import assert from 'node:assert/strict';
import { join } from 'node:path';

const workspacePath = process.env.SHADER_STUDIO_E2E_WORKSPACE;
const fixturePath = join(workspacePath, 'language-servers');

async function languageSnapshot(filePath, language) {
  return browser.executeWorkbench(async (vscode, targetPath, expectedLanguage) => {
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

async function stageSnapshot(filePath, expectations) {
  return browser.executeWorkbench(async (vscode, targetPath, needles) => {
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

async function openDiagnosticDocument(filePath) {
  return browser.executeWorkbench(async (vscode, targetPath) => {
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

async function diagnosticSnapshot(uri, message) {
  return browser.executeWorkbench(async (vscode, documentUri, expected) => {
    const found = vscode.languages.getDiagnostics(vscode.Uri.parse(documentUri))
      .find((item) => item.message.toLocaleLowerCase().includes(expected.toLocaleLowerCase()));
    return found ? { message: found.message, source: found.source, code: found.code } : null;
  }, uri, message);
}

async function waitForDiagnostic(uri, message, present = true) {
  let diagnostic = null;
  await browser.waitUntil(async () => {
    diagnostic = await diagnosticSnapshot(uri, message);
    return Boolean(diagnostic) === present;
  }, {
    timeout: 15_000,
    interval: 100,
    timeoutMsg: `Expected diagnostic ${JSON.stringify(message)} to be ${present ? 'published' : 'cleared'}`,
  });
  return diagnostic;
}

async function replaceDiagnosticDocument(uri, content) {
  await browser.executeWorkbench(async (vscode, documentUri, source) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(documentUri));
    const edit = new vscode.WorkspaceEdit();
    const end = document.positionAt(document.getText().length);
    edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), end), source);
    await vscode.workspace.applyEdit(edit);
  }, uri, content);
}

describe('Shader language servers in VS Code', () => {
  before(async () => {
    assert.ok(workspacePath, 'SHADER_STUDIO_E2E_WORKSPACE was not configured');
    await browser.executeWorkbench(async (vscode) => {
      await vscode.extensions.getExtension('teaqu.shader-studio')?.activate();
    });
  });

  it('provides the complete GLSL authoring feature set', async () => {
    const result = await languageSnapshot(join(fixturePath, 'image.glsl'), 'glsl');

    assert.ok(result.labels.includes('texture'));
    assert.ok(result.labels.includes('iResolution'));
    assert.ok(result.labels.includes('iChannel0'));
    assert.ok(result.labels.includes('shade'));
    assert.ok(result.labels.includes('twice'));
    assert.ok(!result.labels.includes('mainVertex'));
    assert.match(result.completionDocs.texture, /texture|samples/i);
    assert.match(result.builtinHover, /Canvas dimensions/);
    assert.match(result.intrinsicHover, /texture coordinate|texture/i);
    assert.match(result.channelHover, /input channel/i);
    assert.match(result.hookHover, /fragment entry point/i);
    assert.match(result.coordinateHover, /lower-left/i);
    assert.ok(result.definitions.some((item) => item.path.endsWith('common.glsl') && item.line === 0));
    assert.ok(result.signatures.some((item) => item.includes('shade')));
    assert.ok(result.symbols.includes('shade'));
    assert.ok(result.symbols.includes('mainImage'));
    assert.deepEqual(result.colors[0], { red: 1, green: 0.5, blue: 0, alpha: 1 });
    assert.ok(result.colorPresentations.some((item) => item.includes('vec4')), JSON.stringify(result.colorPresentations));
  });

  it('provides the complete Slang authoring feature set through bundled WASM', async () => {
    const result = await languageSnapshot(join(fixturePath, 'image.slang'), 'slang');

    for (const label of ['normalize', 'fmod', 'sampleIChannel0', 'iResolution', 'iChannel0', 'shade', 'twice']) {
      assert.ok(result.labels.includes(label), `Missing Slang completion ${label}`);
    }
    assert.match(result.completionDocs.normalize, /unit length/i, JSON.stringify(result.completionEntries.filter((item) => item.label === 'normalize')));
    assert.match(result.completionDocs.fmod, /remainder/i);
    assert.match(result.completionDocs.sampleIChannel0, /input channel 0/i);
    for (const stageOnly of ['mainVertex', 'numthreads', 'SV_DispatchThreadID', 'writeOutput']) {
      assert.ok(!result.labels.includes(stageOnly), `Unexpected fragment completion ${stageOnly}`);
    }
    assert.match(result.builtinHover, /Canvas dimensions/);
    assert.match(result.intrinsicHover, /remainder/i);
    assert.match(result.channelHover, /input channel/i);
    assert.match(result.hookHover, /fragment entry point/i);
    assert.match(result.coordinateHover, /lower-left/i);
    assert.ok(result.definitions.some((item) => item.path.endsWith('palette.slang')), JSON.stringify(result.definitions));
    assert.ok(result.signatures.some((item) => item.includes('shade')));
    assert.ok(result.symbols.includes('shade'));
    assert.ok(result.symbols.includes('mainImage'));
    assert.deepEqual(result.colors[0], { red: 1, green: 0.5, blue: 0, alpha: 1 });
    assert.ok(result.colorPresentations.some((item) => item.includes('float4')), JSON.stringify(result.colorPresentations));
  });

  it('provides vertex and compute contracts only in their configured stages', async () => {
    const glslVertex = await stageSnapshot(join(fixturePath, 'vertex.glsl'), ['mainVertex', 'deformed', 'surfaceNormal', 'textureUv']);
    assert.match(glslVertex.hovers.mainVertex, /vertex hook/i);
    assert.match(glslVertex.hovers.deformed, /vertex position/i);
    assert.match(glslVertex.hovers.surfaceNormal, /vertex normal/i);
    assert.match(glslVertex.hovers.textureUv, /texture coordinate/i);
    assert.ok(!glslVertex.labels.includes('mainImage'));

    const slangVertex = await stageSnapshot(join(fixturePath, 'vertex.slang'), ['mainVertex', 'deformed', 'surfaceNormal', 'textureUv']);
    assert.match(slangVertex.hovers.mainVertex, /vertex hook/i);
    assert.match(slangVertex.hovers.deformed, /vertex position/i);
    assert.match(slangVertex.hovers.surfaceNormal, /vertex normal/i);
    assert.match(slangVertex.hovers.textureUv, /texture coordinate/i);
    assert.ok(!slangVertex.labels.includes('mainImage'));
    assert.ok(!slangVertex.labels.includes('writeOutput'));

    const compute = await stageSnapshot(join(fixturePath, 'compute.slang'), ['numthreads', 'SV_DispatchThreadID', 'writeOutput']);
    assert.match(compute.hovers.numthreads, /workgroup/i);
    assert.match(compute.hovers.SV_DispatchThreadID, /Global dispatch/i);
    assert.match(compute.hovers.writeOutput, /compute pass output texture/i);
    for (const label of ['numthreads', 'SV_DispatchThreadID', 'writeOutput']) {
      assert.ok(compute.labels.includes(label), `Missing compute completion ${label}`);
    }
    assert.ok(!compute.labels.includes('mainImage'));
    assert.ok(!compute.labels.includes('mainVertex'));
  });

  it('publishes GLSL parser and Slang compiler diagnostics', async () => {
    const glslDocument = await openDiagnosticDocument(join(fixturePath, 'diagnostic.glsl'));
    const glslUri = glslDocument.uri;
    assert.ok(glslDocument.diagnostics.length > 0, JSON.stringify(glslDocument.diagnostics));
    const glsl = await waitForDiagnostic(glslUri, 'include');
    assert.ok(glsl, JSON.stringify(glslDocument.diagnostics));
    assert.match(glsl.source, /shader-studio-glsl/i);
    await replaceDiagnosticDocument(glslUri, 'void mainImage(out vec4 color, in vec2 position) { color = vec4(position, 0.0, 1.0); }');
    await waitForDiagnostic(glslUri, 'include', false);

    const slangDocument = await openDiagnosticDocument(join(fixturePath, 'diagnostic.slang'));
    const slangUri = slangDocument.uri;
    const slang = await waitForDiagnostic(slangUri, 'undefined identifier');
    assert.ok(slang, JSON.stringify(slangDocument.diagnostics));
    assert.equal(slang.source, 'shader-studio-slang-compiler');
  });

});
