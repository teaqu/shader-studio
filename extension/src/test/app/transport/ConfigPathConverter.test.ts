import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigPathConverter } from '../../../app/transport/ConfigPathConverter';

suite('ConfigPathConverter Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        mockWebview = {
            html: '',
            onDidReceiveMessage: sandbox.stub().returns({ dispose: sandbox.stub() }),
            postMessage: sandbox.stub(),
            asWebviewUri: sandbox.stub().returns(vscode.Uri.file('/mock/uri')),
            options: {},
            cspSource: '',
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('convertUriForClient returns original path when no webview provided', () => {
        const filePath = '/test/path/file.txt';
        const result = ConfigPathConverter.convertUriForClient(filePath, null as any);
        assert.strictEqual(result, filePath);
    });

    test('convertUriForClient converts path using webview asWebviewUri', () => {
        const filePath = '/test/path/file.txt';
        const expectedUri = vscode.Uri.parse('vscode-webview://test/file.txt');
        mockWebview.asWebviewUri.returns(expectedUri);
        
        const result = ConfigPathConverter.convertUriForClient(filePath, mockWebview);
        
        assert.strictEqual(result, expectedUri.toString());
        sinon.assert.calledWith(mockWebview.asWebviewUri, vscode.Uri.file(filePath));
    });

    test('processConfigPaths processes shader config texture paths correctly', () => {
        const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/test-texture.png');
        mockWebview.asWebviewUri.returns(mockUri);
        
        const originalMessage = {
            type: 'shaderSource',
            code: 'shader code',
            config: {
                version: '1.0',
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: {
                                type: 'texture',
                                path: '/absolute/path/to/texture.png'
                            }
                        }
                    }
                }
            }
        };
        
        const processedMessage = ConfigPathConverter.processConfigPaths(originalMessage as any, mockWebview);
        
        assert.strictEqual(processedMessage.type, 'shaderSource');
        assert.strictEqual((processedMessage.config.passes.Image.inputs as any).iChannel0.path, mockUri.toString());
        
        // Original should not be mutated
        assert.strictEqual(originalMessage.config.passes.Image.inputs.iChannel0.path, '/absolute/path/to/texture.png');
    });

    test('processConfigPaths handles config without inputs', () => {
        const message = {
            type: 'shaderSource',
            code: 'shader code',
            config: {
                version: '1.0',
                passes: {
                    Image: {
                        // No inputs
                    }
                }
            }
        };
        
        assert.doesNotThrow(() => {
            ConfigPathConverter.processConfigPaths(message as any, mockWebview);
        });
    });

    test('processConfigPaths handles message without config', () => {
        const message = {
            type: 'shaderSource',
            code: 'shader code'
        };
        
        const result = ConfigPathConverter.processConfigPaths(message as any, mockWebview);
        
        assert.strictEqual(result.type, 'shaderSource');
        assert.strictEqual(result.code, 'shader code');
    });

    test('processConfigPaths processes multiple texture inputs', () => {
        const mockUri1 = vscode.Uri.parse('vscode-webview://webview-panel/texture1.png');
        const mockUri2 = vscode.Uri.parse('vscode-webview://webview-panel/texture2.png');
        
        let callCount = 0;
        mockWebview.asWebviewUri.callsFake(() => {
            callCount++;
            return callCount === 1 ? mockUri1 : mockUri2;
        });
        
        const message = {
            type: 'shaderSource',
            code: 'shader code',
            config: {
                version: '1.0',
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: {
                                type: 'texture',
                                path: '/absolute/path/to/texture1.png'
                            },
                            iChannel1: {
                                type: 'texture',
                                path: '/absolute/path/to/texture2.png'
                            }
                        }
                    }
                }
            }
        };
        
        const result = ConfigPathConverter.processConfigPaths(message as any, mockWebview);
        
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.path, mockUri1.toString());
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel1.path, mockUri2.toString());
    });

    test('processConfigPaths processes multiple passes', () => {
        const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/texture.png');
        mockWebview.asWebviewUri.returns(mockUri);
        
        const message = {
            type: 'shaderSource',
            code: 'shader code',
            config: {
                version: '1.0',
                passes: {
                    BufferA: {
                        inputs: {
                            iChannel0: {
                                type: 'texture',
                                path: '/absolute/path/to/texture.png'
                            }
                        }
                    },
                    Image: {
                        inputs: {
                            iChannel0: {
                                type: 'texture',
                                path: '/absolute/path/to/texture.png'
                            }
                        }
                    }
                }
            }
        };
        
        const result = ConfigPathConverter.processConfigPaths(message as any, mockWebview);
        
        assert.strictEqual((result.config.passes.BufferA?.inputs as any).iChannel0.path, mockUri.toString());
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.path, mockUri.toString());
    });

    test('processConfigPaths handles non-texture inputs', () => {
        const message = {
            type: 'shaderSource',
            code: 'shader code',
            config: {
                version: '1.0',
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: {
                                type: 'buffer',
                                name: 'BufferA'
                            }
                        }
                    }
                }
            }
        };
        
        const result = ConfigPathConverter.processConfigPaths(message as any, mockWebview);
        
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.type, 'buffer');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.name, 'BufferA');
    });
});
