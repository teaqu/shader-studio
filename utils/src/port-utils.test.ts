import { describe, it, expect } from 'vitest';
import { parseWebSocketPortFromArgs, getWebSocketPortFromConfig, injectPortIntoHtml } from './port-utils';

describe('parseWebSocketPortFromArgs', () => {
    it('should return default port 51472 when no wsPort argument is provided', () => {
        const result = parseWebSocketPortFromArgs(['--other-arg', 'value']);
        expect(result).toBe(51472);
    });

    it('should return default port 51472 when empty arguments array is provided', () => {
        const result = parseWebSocketPortFromArgs([]);
        expect(result).toBe(51472);
    });

    it('should parse valid port from wsPort argument', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=8080', '--other-arg']);
        expect(result).toBe(8080);
    });

    it('should return default port when wsPort value is invalid (NaN)', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=invalid']);
        expect(result).toBe(51472);
    });

    it('should return default port when port is below valid range (< 1)', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=0']);
        expect(result).toBe(51472);
    });

    it('should return default port when port is above valid range (> 65535)', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=65536']);
        expect(result).toBe(51472);
    });

    it('should handle valid port at lower boundary (1)', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=1']);
        expect(result).toBe(1);
    });

    it('should handle valid port at upper boundary (65535)', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=65535']);
        expect(result).toBe(65535);
    });

    it('should handle multiple wsPort arguments and use the first one', () => {
        const result = parseWebSocketPortFromArgs(['--wsPort=3000', '--wsPort=4000']);
        expect(result).toBe(3000);
    });
});

describe('getWebSocketPortFromConfig', () => {
    it('should return default port 51472 when config is null', () => {
        const result = getWebSocketPortFromConfig(null);
        expect(result).toBe(51472);
    });

    it('should return default port 51472 when config.get returns undefined', () => {
        const mockConfig = {
            get: () => undefined
        };
        const result = getWebSocketPortFromConfig(mockConfig);
        expect(result).toBe(51472);
    });

    it('should return default port 51472 when config.get returns null', () => {
        const mockConfig = {
            get: () => null
        };
        const result = getWebSocketPortFromConfig(mockConfig);
        expect(result).toBe(51472);
    });

    it('should return configured port when valid', () => {
        const mockConfig = {
            get: (key: string) => key === 'webSocketPort' ? 9000 : undefined
        };
        const result = getWebSocketPortFromConfig(mockConfig);
        expect(result).toBe(9000);
    });

    it('should return default port when configured port is invalid (NaN)', () => {
        const mockConfig = {
            get: () => 'invalid'
        };
        const result = getWebSocketPortFromConfig(mockConfig);
        expect(result).toBe(51472);
    });

    it('should return default port when configured port is below valid range', () => {
        const mockConfig = {
            get: () => -1
        };
        const result = getWebSocketPortFromConfig(mockConfig);
        expect(result).toBe(51472);
    });

    it('should return default port when configured port is above valid range', () => {
        const mockConfig = {
            get: () => 70000
        };
        const result = getWebSocketPortFromConfig(mockConfig);
        expect(result).toBe(51472);
    });

    it('should handle valid port at boundaries', () => {
        const mockConfigMin = {
            get: () => 1
        };
        const mockConfigMax = {
            get: () => 65535
        };

        expect(getWebSocketPortFromConfig(mockConfigMin)).toBe(1);
        expect(getWebSocketPortFromConfig(mockConfigMax)).toBe(65535);
    });
});

describe('injectPortIntoHtml', () => {
    it('should inject port configuration script into HTML head', () => {
        const htmlContent = '<html><head><title>Test</title></head><body></body></html>';
        const result = injectPortIntoHtml(htmlContent, 8080);

        expect(result).toContain('<script>window.shaderViewConfig = { port: 8080 };</script>');
        expect(result).toContain('<head><script>window.shaderViewConfig = { port: 8080 };</script><title>Test</title>');
    });

    it('should inject port configuration with default port', () => {
        const htmlContent = '<html><head></head><body></body></html>';
        const result = injectPortIntoHtml(htmlContent, 51472);

        expect(result).toContain('window.shaderViewConfig = { port: 51472 }');
    });

    it('should handle HTML without explicit head tag', () => {
        const htmlContent = '<html><body></body></html>';
        const result = injectPortIntoHtml(htmlContent, 3000);

        // Should return original content since no <head> tag found
        expect(result).toBe(htmlContent);
    });

    it('should handle empty HTML content', () => {
        const htmlContent = '';
        const result = injectPortIntoHtml(htmlContent, 3000);

        expect(result).toBe('');
    });

    it('should inject script tag even with existing scripts in head', () => {
        const htmlContent = '<html><head><script>console.log("existing");</script></head><body></body></html>';
        const result = injectPortIntoHtml(htmlContent, 4000);

        expect(result).toContain('<head><script>window.shaderViewConfig = { port: 4000 };</script><script>console.log("existing");</script>');
    });

    it('should handle multiple head tags (should only replace first occurrence)', () => {
        const htmlContent = '<html><head><title>First</title></head><body><head>Second</head></body></html>';
        const result = injectPortIntoHtml(htmlContent, 5000);

        expect(result).toContain('<head><script>window.shaderViewConfig = { port: 5000 };</script><title>First</title>');
        expect(result).toContain('<head>Second</head>'); // Second head should remain unchanged
    });
});
