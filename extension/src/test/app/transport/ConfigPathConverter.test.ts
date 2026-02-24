import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ConfigPathConverter } from '../../../app/transport/ConfigPathConverter';

suite('ConfigPathConverter Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWebview: sinon.SinonStubbedInstance<vscode.Webview>;
    let workspaceGetWorkspaceFolderStub: sinon.SinonStub;

    const WORKSPACE_ROOT = path.join(path.sep, 'workspace');

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

        // Mock workspace folder for @ path resolution
        workspaceGetWorkspaceFolderStub = sandbox.stub(vscode.workspace, 'getWorkspaceFolder');
        workspaceGetWorkspaceFolderStub.returns({
            uri: { fsPath: WORKSPACE_ROOT },
            name: 'workspace',
            index: 0
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    test('convertUriForClient returns original path when no webview provided', () => {
        const filePath = '/test/path/file.txt';
        const result = ConfigPathConverter.convertUriForClient(
            filePath, 
            null as any
        );
        assert.strictEqual(result, filePath);
    });

    test('convertUriForClient converts path using webview asWebviewUri', () => {
        const filePath = '/test/path/file.txt';
        const expectedUri = vscode.Uri.parse('vscode-webview://test/file.txt');
        mockWebview.asWebviewUri.returns(expectedUri);
        
        const result = ConfigPathConverter.convertUriForClient(
            filePath, 
            mockWebview
        );
        
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
        
        const processedMessage = ConfigPathConverter.processConfigPaths(
            originalMessage as any, 
            mockWebview
        );
        
        assert.strictEqual(processedMessage.type, 'shaderSource');
        // Path should be preserved, resolved_path should have webview URI
        assert.strictEqual((processedMessage.config.passes.Image.inputs as any).iChannel0.path, '/absolute/path/to/texture.png');
        assert.strictEqual((processedMessage.config.passes.Image.inputs as any).iChannel0.resolved_path, mockUri.toString());

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
        
        const result = ConfigPathConverter.processConfigPaths(
            message as any, 
            mockWebview
        );
        
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
        
        const result = ConfigPathConverter.processConfigPaths(
            message as any, 
            mockWebview
        );
        
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.path, '/absolute/path/to/texture1.png');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.resolved_path, mockUri1.toString());
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel1.path, '/absolute/path/to/texture2.png');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel1.resolved_path, mockUri2.toString());
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
        
        const result = ConfigPathConverter.processConfigPaths(
            message as any, 
            mockWebview
        );
        
        assert.strictEqual((result.config.passes.BufferA?.inputs as any).iChannel0.path, '/absolute/path/to/texture.png');
        assert.strictEqual((result.config.passes.BufferA?.inputs as any).iChannel0.resolved_path, mockUri.toString());
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.path, '/absolute/path/to/texture.png');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.resolved_path, mockUri.toString());
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
        
        const result = ConfigPathConverter.processConfigPaths(
            message as any, 
            mockWebview
        );
        
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.type, 'buffer');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.name, 'BufferA');
    });

    test('processConfigPaths processes video input paths correctly', () => {
        const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/test-video.mp4');
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
                                type: 'video',
                                path: '/absolute/path/to/video.mp4'
                            }
                        }
                    }
                }
            }
        };
        
        const processedMessage = ConfigPathConverter.processConfigPaths(
            originalMessage as any, 
            mockWebview
        );
        
        assert.strictEqual(processedMessage.type, 'shaderSource');
        // Path should be preserved, resolved_path should have webview URI
        assert.strictEqual((processedMessage.config.passes.Image.inputs as any).iChannel0.path, '/absolute/path/to/video.mp4');
        assert.strictEqual((processedMessage.config.passes.Image.inputs as any).iChannel0.resolved_path, mockUri.toString());

        // Original should not be mutated
        assert.strictEqual(originalMessage.config.passes.Image.inputs.iChannel0.path, '/absolute/path/to/video.mp4');
    });

    test('processConfigPaths processes mixed texture and video inputs', () => {
        const mockTextureUri = vscode.Uri.parse('vscode-webview://webview-panel/texture.png');
        const mockVideoUri = vscode.Uri.parse('vscode-webview://webview-panel/video.mp4');
        
        let callCount = 0;
        mockWebview.asWebviewUri.callsFake(() => {
            callCount++;
            return callCount === 1 ? mockTextureUri : mockVideoUri;
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
                                path: '/absolute/path/to/texture.png'
                            },
                            iChannel1: {
                                type: 'video',
                                path: '/absolute/path/to/video.mp4'
                            }
                        }
                    }
                }
            }
        };
        
        const result = ConfigPathConverter.processConfigPaths(
            message as any, 
            mockWebview
        );
        
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.path, '/absolute/path/to/texture.png');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel0.resolved_path, mockTextureUri.toString());
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel1.path, '/absolute/path/to/video.mp4');
        assert.strictEqual((result.config.passes.Image.inputs as any).iChannel1.resolved_path, mockVideoUri.toString());
    });

    test('processConfigPaths handles video input with additional properties', () => {
        const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/video.mp4');
        mockWebview.asWebviewUri.returns(mockUri);

        const message = {
            type: 'shaderSource',
            code: 'shader code',
            config: {
                version: '1.0',
                passes: {
                    Image: {
                        inputs: {
                            iChannel0: {
                                type: 'video',
                                path: '/absolute/path/to/video.mp4',
                                filter: 'linear',
                                wrap: 'clamp',
                                vflip: true
                            }
                        }
                    }
                }
            }
        };

        const result = ConfigPathConverter.processConfigPaths(
            message as any,
            mockWebview
        );

        const input = (result.config.passes.Image.inputs as any).iChannel0;
        assert.strictEqual(input.path, '/absolute/path/to/video.mp4');
        assert.strictEqual(input.resolved_path, mockUri.toString());
        assert.strictEqual(input.type, 'video');
        assert.strictEqual(input.filter, 'linear');
        assert.strictEqual(input.wrap, 'clamp');
        assert.strictEqual(input.vflip, true);
    });

    suite('Workspace-relative @ path resolution', () => {
        test('processConfigPaths resolves @ texture path from workspace root', () => {
            const expectedAbsPath = path.join(WORKSPACE_ROOT, 'textures', 'noise.png');
            const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/noise.png');
            mockWebview.asWebviewUri.returns(mockUri);

            const message = {
                type: 'shaderSource',
                code: 'shader code',
                path: path.join(WORKSPACE_ROOT, 'shaders', 'main.glsl'),
                config: {
                    version: '1.0',
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: {
                                    type: 'texture',
                                    path: '@/textures/noise.png'
                                }
                            }
                        }
                    }
                }
            };

            const result = ConfigPathConverter.processConfigPaths(
                message as any,
                mockWebview
            );

            const input = (result.config.passes.Image.inputs as any).iChannel0;
            // Original path preserved
            assert.strictEqual(input.path, '@/textures/noise.png');
            // resolved_path set via webview URI
            assert.strictEqual(input.resolved_path, mockUri.toString());
            // asWebviewUri called with the correct absolute path
            sinon.assert.calledWith(mockWebview.asWebviewUri, vscode.Uri.file(expectedAbsPath));
        });

        test('processConfigPaths resolves @ video path from workspace root', () => {
            const expectedAbsPath = path.join(WORKSPACE_ROOT, 'videos', 'clip.mp4');
            const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/clip.mp4');
            mockWebview.asWebviewUri.returns(mockUri);

            const message = {
                type: 'shaderSource',
                code: 'shader code',
                path: path.join(WORKSPACE_ROOT, 'shaders', 'main.glsl'),
                config: {
                    version: '1.0',
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: {
                                    type: 'video',
                                    path: '@/videos/clip.mp4'
                                }
                            }
                        }
                    }
                }
            };

            const result = ConfigPathConverter.processConfigPaths(
                message as any,
                mockWebview
            );

            const input = (result.config.passes.Image.inputs as any).iChannel0;
            assert.strictEqual(input.path, '@/videos/clip.mp4');
            assert.strictEqual(input.resolved_path, mockUri.toString());
            sinon.assert.calledWith(mockWebview.asWebviewUri, vscode.Uri.file(expectedAbsPath));
        });

        test('processConfigPaths resolves @/ path in buffer pass', () => {
            const expectedAbsPath = path.join(WORKSPACE_ROOT, 'assets', 'stone.png');
            const mockUri = vscode.Uri.parse('vscode-webview://webview-panel/stone.png');
            mockWebview.asWebviewUri.returns(mockUri);

            const message = {
                type: 'shaderSource',
                code: 'shader code',
                path: path.join(WORKSPACE_ROOT, 'shaders', 'nested', 'deep', 'main.glsl'),
                config: {
                    version: '1.0',
                    passes: {
                        BufferA: {
                            inputs: {
                                iChannel0: {
                                    type: 'texture',
                                    path: '@/assets/stone.png'
                                }
                            }
                        },
                        Image: {
                            inputs: {}
                        }
                    }
                }
            };

            const result = ConfigPathConverter.processConfigPaths(
                message as any,
                mockWebview
            );

            const input = (result.config.passes.BufferA?.inputs as any).iChannel0;
            assert.strictEqual(input.path, '@/assets/stone.png');
            assert.strictEqual(input.resolved_path, mockUri.toString());
            sinon.assert.calledWith(mockWebview.asWebviewUri, vscode.Uri.file(expectedAbsPath));
        });

        test('processConfigPaths handles mixed @ and relative paths', () => {
            const shaderPath = path.join(WORKSPACE_ROOT, 'shaders', 'main.glsl');
            const expectedWorkspacePath = path.join(WORKSPACE_ROOT, 'textures', 'noise.png');
            const expectedRelativePath = path.join(WORKSPACE_ROOT, 'shaders', 'local.png');
            const mockUri1 = vscode.Uri.parse('vscode-webview://webview-panel/noise.png');
            const mockUri2 = vscode.Uri.parse('vscode-webview://webview-panel/local.png');

            let callCount = 0;
            mockWebview.asWebviewUri.callsFake(() => {
                callCount++;
                return callCount === 1 ? mockUri1 : mockUri2;
            });

            const message = {
                type: 'shaderSource',
                code: 'shader code',
                path: shaderPath,
                config: {
                    version: '1.0',
                    passes: {
                        Image: {
                            inputs: {
                                iChannel0: {
                                    type: 'texture',
                                    path: '@/textures/noise.png'
                                },
                                iChannel1: {
                                    type: 'texture',
                                    path: 'local.png'
                                }
                            }
                        }
                    }
                }
            };

            const result = ConfigPathConverter.processConfigPaths(
                message as any,
                mockWebview
            );

            const input0 = (result.config.passes.Image.inputs as any).iChannel0;
            const input1 = (result.config.passes.Image.inputs as any).iChannel1;

            assert.strictEqual(input0.path, '@/textures/noise.png');
            assert.strictEqual(input0.resolved_path, mockUri1.toString());
            assert.strictEqual(input1.path, 'local.png');
            assert.strictEqual(input1.resolved_path, mockUri2.toString());
        });
    });
});
