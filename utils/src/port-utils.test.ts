import { describe, it, expect } from 'vitest';
import { injectPortIntoHtml } from './port-utils';

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
