export function injectPortIntoHtml(htmlContent: string, port: number): string {
    const scriptTag = `<script>window.shaderViewConfig = { port: ${port} };</script>`;
    return htmlContent.replace('<head>', `<head>${scriptTag}`);
}
