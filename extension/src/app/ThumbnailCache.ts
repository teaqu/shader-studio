import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { createHash } from "crypto";

export class ThumbnailCache {
    private cacheDir: string;

    constructor(private context: vscode.ExtensionContext) {
        this.cacheDir = path.join(context.globalStorageUri.fsPath, "thumbnails");
        this.ensureCacheDir();
    }

    private ensureCacheDir(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Generate a unique cache key for a shader file
     */
    private getCacheKey(shaderPath: string, modifiedTime?: number): string {
        const hash = createHash("md5");
        hash.update(shaderPath);
        if (modifiedTime) {
            hash.update(modifiedTime.toString());
        }
        return hash.digest("hex");
    }

    /**
     * Get the path to a cached thumbnail
     */
    private getThumbnailPath(cacheKey: string): string {
        return path.join(this.cacheDir, `${cacheKey}.png`);
    }

    /**
     * Check if a thumbnail exists in cache
     */
    public hasThumbnail(shaderPath: string, modifiedTime?: number): boolean {
        const cacheKey = this.getCacheKey(shaderPath, modifiedTime);
        const thumbnailPath = this.getThumbnailPath(cacheKey);
        return fs.existsSync(thumbnailPath);
    }

    /**
     * Get a cached thumbnail as a data URI
     */
    public getThumbnail(shaderPath: string, modifiedTime?: number): string | null {
        const cacheKey = this.getCacheKey(shaderPath, modifiedTime);
        const thumbnailPath = this.getThumbnailPath(cacheKey);

        if (!fs.existsSync(thumbnailPath)) {
            return null;
        }

        try {
            const buffer = fs.readFileSync(thumbnailPath);
            const base64 = buffer.toString("base64");
            return `data:image/png;base64,${base64}`;
        } catch (error) {
            console.error(`Failed to read thumbnail: ${error}`);
            return null;
        }
    }

    /**
     * Save a thumbnail to cache
     */
    public saveThumbnail(shaderPath: string, dataUri: string, modifiedTime?: number): boolean {
        const cacheKey = this.getCacheKey(shaderPath, modifiedTime);
        const thumbnailPath = this.getThumbnailPath(cacheKey);

        try {
            // Extract base64 data from data URI
            const base64Data = dataUri.replace(/^data:image\/png;base64,/, "");
            const buffer = Buffer.from(base64Data, "base64");
            
            fs.writeFileSync(thumbnailPath, buffer);
            return true;
        } catch (error) {
            console.error(`Failed to save thumbnail: ${error}`);
            return false;
        }
    }

    /**
     * Clear all cached thumbnails
     */
    public clearCache(): void {
        if (!fs.existsSync(this.cacheDir)) {
            return;
        }

        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Failed to delete cached thumbnail: ${error}`);
            }
        }
    }

    /**
     * Remove old/stale thumbnails that don't match current shader files
     */
    public async pruneCache(currentShaderPaths: string[]): Promise<void> {
        if (!fs.existsSync(this.cacheDir)) {
            return;
        }

        // Build a set of valid cache keys
        const validKeys = new Set<string>();
        for (const shaderPath of currentShaderPaths) {
            try {
                const stats = fs.statSync(shaderPath);
                const cacheKey = this.getCacheKey(shaderPath, stats.mtimeMs);
                validKeys.add(cacheKey);
            } catch (error) {
                // Shader file doesn't exist anymore, skip
            }
        }

        // Remove thumbnails that don't match any current shader
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
            const cacheKey = path.basename(file, ".png");
            if (!validKeys.has(cacheKey)) {
                const filePath = path.join(this.cacheDir, file);
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error(`Failed to delete stale thumbnail: ${error}`);
                }
            }
        }
    }
}
