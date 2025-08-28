export function parseWebSocketPortFromArgs(argv: string[]): number {
    const wsPortArg = argv.find(arg => arg.startsWith('--wsPort='));
    const port = wsPortArg ? parseInt(wsPortArg.split('=')[1], 10) : 51472;

    // Validate port range
    if (isNaN(port) || port < 1 || port > 65535) {
        return 51472;
    }

    return port;
}

export function getWebSocketPortFromConfig(config: any): number {
    const port = (config?.get("webSocketPort") as number) || 51472;

    // Validate port range
    if (isNaN(port) || port < 1 || port > 65535) {
        return 51472;
    }

    return port;
}

export function injectPortIntoHtml(htmlContent: string, port: number): string {
    const scriptTag = `<script>window.shaderViewConfig = { port: ${port} };</script>`;
    return htmlContent.replace('<head>', `<head>${scriptTag}`);
}
