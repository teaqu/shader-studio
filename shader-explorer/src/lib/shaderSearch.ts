import type { ShaderFile } from './types/ShaderFile';

export interface ShaderSearchMessage {
    type: 'searchShaders';
    query: string;
    requestId: number;
}

export interface ShaderSearchResultsMessage {
    type: 'shaderSearchResults';
    query: string;
    requestId: number;
    paths: string[];
}

export type ShaderExplorerSortBy = 'name' | 'updated' | 'created';
export type ShaderExplorerSortOrder = 'asc' | 'desc';

interface VisibleShaderSearchParams {
    shaders: ShaderFile[];
    search: string;
    searchResultPaths: string[] | null;
    hideFailedShaders: boolean;
    failedShaderPaths: Set<string>;
    sortBy: ShaderExplorerSortBy;
    sortOrder: ShaderExplorerSortOrder;
}

type PostMessage = (message: ShaderSearchMessage) => void;

export function createShaderSearchScheduler(
    postMessage: PostMessage,
    delay = 150,
) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let requestId = 0;

    return {
        schedule(query: string): number | null {
            if (timeout) {
                clearTimeout(timeout);
            }

            const trimmedQuery = query.trim();
            if (!trimmedQuery) {
                return null;
            }

            requestId += 1;
            const nextRequestId = requestId;
            timeout = setTimeout(() => {
                postMessage({
                    type: 'searchShaders',
                    query: trimmedQuery,
                    requestId: nextRequestId,
                });
            }, delay);

            return nextRequestId;
        },

        dispose(): void {
            if (timeout) {
                clearTimeout(timeout);
            }
        },
    };
}

export function isCurrentShaderSearchResult(
    message: ShaderSearchResultsMessage,
    activeRequestId: number,
    currentQuery: string,
): boolean {
    return message.requestId === activeRequestId
        && message.query.trim() === currentQuery.trim();
}

export function orderShadersBySearchPaths(
    shaders: ShaderFile[],
    paths: string[],
): ShaderFile[] {
    const orderByPath = new Map(paths.map((path, index) => [path, index]));
    return shaders
        .filter(shader => orderByPath.has(shader.path))
        .sort((a, b) => orderByPath.get(a.path)! - orderByPath.get(b.path)!);
}

export function getVisibleShadersForSearch({
    shaders,
    search,
    searchResultPaths,
    hideFailedShaders,
    failedShaderPaths,
    sortBy,
    sortOrder,
}: VisibleShaderSearchParams): ShaderFile[] {
    const hasSearch = search.trim().length > 0;
    let visible = hasSearch && searchResultPaths !== null
        ? orderShadersBySearchPaths(shaders, searchResultPaths)
        : sortShaders(shaders, sortBy, sortOrder);

    if (hideFailedShaders) {
        visible = visible.filter(shader => !failedShaderPaths.has(shader.path));
    }

    return visible;
}

function sortShaders(
    shaders: ShaderFile[],
    sortBy: ShaderExplorerSortBy,
    sortOrder: ShaderExplorerSortOrder,
): ShaderFile[] {
    return [...shaders].sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'name') {
            comparison = a.name.localeCompare(b.name);
        } else if (sortBy === 'updated') {
            const aTime = a.modifiedTime || 0;
            const bTime = b.modifiedTime || 0;
            comparison = bTime - aTime;
        } else if (sortBy === 'created') {
            const aTime = a.createdTime || 0;
            const bTime = b.createdTime || 0;
            comparison = bTime - aTime;
        }
        return sortOrder === 'asc' ? -comparison : comparison;
    });
}
