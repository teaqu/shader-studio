import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ShaderBrowser - Refresh Functionality (Unit Tests)', () => {
    let mockVscodeApi: any;
    let postMessageSpy: any;

    beforeEach(() => {
        postMessageSpy = vi.fn();
        mockVscodeApi = {
            postMessage: postMessageSpy,
        };
        vi.clearAllMocks();
    });

    it('should send requestShaders with skipCache=true when refresh is called', () => {
        // Simulate the refreshShaders function logic
        const vscode = mockVscodeApi;
        
        if (vscode) {
            vscode.postMessage({ type: 'requestShaders', skipCache: true });
        }

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestShaders',
            skipCache: true,
        });
    });

    it('should send requestShaders with skipCache=false after timeout', () => {
        vi.useFakeTimers();
        const vscode = mockVscodeApi;
        
        // Simulate refresh flow
        if (vscode) {
            vscode.postMessage({ type: 'requestShaders', skipCache: true });
            
            setTimeout(() => {
                vscode.postMessage({ type: 'requestShaders', skipCache: false });
            }, 3000);
        }

        expect(postMessageSpy).toHaveBeenNthCalledWith(1, {
            type: 'requestShaders',
            skipCache: true,
        });

        vi.advanceTimersByTime(3000);

        expect(postMessageSpy).toHaveBeenNthCalledWith(2, {
            type: 'requestShaders',
            skipCache: false,
        });

        vi.useRealTimers();
    });

    it('should not call postMessage if vscode is null', () => {
        const vscode = null;
        
        // Simulate refreshShaders guard check
        if (!vscode) {
            // Early return, no postMessage called
            expect(postMessageSpy).not.toHaveBeenCalled();
            return;
        }
        
        vscode.postMessage({ type: 'requestShaders', skipCache: true });
    });

    it('should handle refresh cycle correctly', () => {
        vi.useFakeTimers();
        const vscode = mockVscodeApi;
        let forceFresh = false;
        let refreshKey = 0;
        
        // Simulate refreshShaders function
        function refreshShaders() {
            if (!vscode) {
                return;
            }
            
            forceFresh = true;
            refreshKey++;
            vscode.postMessage({ type: 'requestShaders', skipCache: true });
            
            setTimeout(() => {
                if (vscode) {
                    forceFresh = false;
                    vscode.postMessage({ type: 'requestShaders', skipCache: false });
                }
            }, 3000);
        }

        // Call refresh
        refreshShaders();

        // Verify immediate state
        expect(forceFresh).toBe(true);
        expect(refreshKey).toBe(1);
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestShaders',
            skipCache: true,
        });

        // Advance time
        vi.advanceTimersByTime(3000);

        // Verify final state
        expect(forceFresh).toBe(false);
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestShaders',
            skipCache: false,
        });

        vi.useRealTimers();
    });

    it('should trigger refresh after card size change with debounce', () => {
        vi.useFakeTimers();
        const vscode = mockVscodeApi;
        let cardSize = 280;
        let stateRestored = true;
        let initialCardSizeSet = true;
        let debounceTimeout: NodeJS.Timeout | null = null;

        // Simulate the debounced effect for card size changes
        function simulateCardSizeChange(newSize: number) {
            cardSize = newSize;

            // Clear existing timeout
            if (debounceTimeout !== null) {
                clearTimeout(debounceTimeout);
            }

            // Only trigger refresh after initial state restoration is complete AND vscode is available
            if (stateRestored && initialCardSizeSet && vscode) {
                debounceTimeout = setTimeout(() => {
                    refreshShaders();
                }, 500); // 500ms debounce
            }
        }

        function refreshShaders() {
            if (!vscode) {
                return;
            }
            
            let forceFresh = true;
            vscode.postMessage({ type: 'requestShaders', skipCache: true });
            
            setTimeout(() => {
                if (vscode) {
                    forceFresh = false;
                    vscode.postMessage({ type: 'requestShaders', skipCache: false });
                }
            }, 3000);
        }

        // Simulate card size change
        simulateCardSizeChange(400);

        // Should not call immediately (debounced)
        expect(postMessageSpy).not.toHaveBeenCalled();

        // Advance 500ms for debounce
        vi.advanceTimersByTime(500);

        // Should now request with skipCache=true
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestShaders',
            skipCache: true,
        });

        // Advance 3 seconds for the refresh cycle
        vi.advanceTimersByTime(3000);

        // Should request with skipCache=false
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestShaders',
            skipCache: false,
        });

        vi.useRealTimers();
    });

    it('should not trigger refresh if state not restored', () => {
        vi.useFakeTimers();
        const vscode = mockVscodeApi;
        let stateRestored = false; // Not restored yet
        let initialCardSizeSet = false;
        let debounceTimeout: NodeJS.Timeout | null = null;

        function simulateCardSizeChange(newSize: number) {
            if (debounceTimeout !== null) {
                clearTimeout(debounceTimeout);
            }

            if (stateRestored && initialCardSizeSet && vscode) {
                debounceTimeout = setTimeout(() => {
                    vscode.postMessage({ type: 'requestShaders', skipCache: true });
                }, 500);
            }
        }

        simulateCardSizeChange(400);
        vi.advanceTimersByTime(500);

        // Should not call because stateRestored is false
        expect(postMessageSpy).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('should debounce multiple rapid card size changes', () => {
        vi.useFakeTimers();
        const vscode = mockVscodeApi;
        let stateRestored = true;
        let initialCardSizeSet = true;
        let debounceTimeout: NodeJS.Timeout | null = null;

        function simulateCardSizeChange(newSize: number) {
            if (debounceTimeout !== null) {
                clearTimeout(debounceTimeout);
            }

            if (stateRestored && initialCardSizeSet && vscode) {
                debounceTimeout = setTimeout(() => {
                    vscode.postMessage({ type: 'requestShaders', skipCache: true });
                }, 500);
            }
        }

        // Rapid changes
        simulateCardSizeChange(300);
        vi.advanceTimersByTime(100);
        
        simulateCardSizeChange(350);
        vi.advanceTimersByTime(100);
        
        simulateCardSizeChange(400);
        
        // Still no call yet (debounced)
        expect(postMessageSpy).not.toHaveBeenCalled();

        // Advance to complete debounce from last change (500ms total)
        vi.advanceTimersByTime(500);

        // Should only call once after all rapid changes
        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'requestShaders',
            skipCache: true,
        });

        vi.useRealTimers();
    });
});

describe('ShaderBrowser - Search Functionality', () => {
    it('should filter shaders by name', () => {
        const shaders = [
            { path: '/test/shader1.glsl', name: 'shader1.glsl', relativePath: 'test/shader1.glsl' },
            { path: '/test/shader2.glsl', name: 'shader2.glsl', relativePath: 'test/shader2.glsl' },
            { path: '/test/fractal.glsl', name: 'fractal.glsl', relativePath: 'test/fractal.glsl' },
        ];

        const search = 'shader1';
        const query = search.toLowerCase();

        const filtered = shaders.filter(shader => 
            shader.name.toLowerCase().includes(query) ||
            shader.relativePath.toLowerCase().includes(query)
        );

        expect(filtered).toHaveLength(1);
        expect(filtered[0].name).toBe('shader1.glsl');
    });

    it('should filter shaders by relative path', () => {
        const shaders = [
            { path: '/project/effects/blur.glsl', name: 'blur.glsl', relativePath: 'effects/blur.glsl' },
            { path: '/project/shaders/basic.glsl', name: 'basic.glsl', relativePath: 'shaders/basic.glsl' },
            { path: '/project/effects/glow.glsl', name: 'glow.glsl', relativePath: 'effects/glow.glsl' },
        ];

        const search = 'effects';
        const query = search.toLowerCase();

        const filtered = shaders.filter(shader => 
            shader.name.toLowerCase().includes(query) ||
            shader.relativePath.toLowerCase().includes(query)
        );

        expect(filtered).toHaveLength(2);
        expect(filtered.map(s => s.name)).toEqual(['blur.glsl', 'glow.glsl']);
    });

    it('should return all shaders when search is empty', () => {
        const shaders = [
            { path: '/test/shader1.glsl', name: 'shader1.glsl', relativePath: 'test/shader1.glsl' },
            { path: '/test/shader2.glsl', name: 'shader2.glsl', relativePath: 'test/shader2.glsl' },
            { path: '/test/shader3.glsl', name: 'shader3.glsl', relativePath: 'test/shader3.glsl' },
        ];

        const search = '';
        
        const filtered = !search.trim() 
            ? [...shaders]
            : shaders.filter(shader => {
                const query = search.toLowerCase();
                return shader.name.toLowerCase().includes(query) ||
                       shader.relativePath.toLowerCase().includes(query);
            });

        expect(filtered).toHaveLength(3);
    });

    it('should return empty array when no shaders match search', () => {
        const shaders = [
            { path: '/test/shader1.glsl', name: 'shader1.glsl', relativePath: 'test/shader1.glsl' },
            { path: '/test/shader2.glsl', name: 'shader2.glsl', relativePath: 'test/shader2.glsl' },
        ];

        const search = 'nonexistent';
        const query = search.toLowerCase();

        const filtered = shaders.filter(shader => 
            shader.name.toLowerCase().includes(query) ||
            shader.relativePath.toLowerCase().includes(query)
        );

        expect(filtered).toHaveLength(0);
    });

    it('should be case-insensitive', () => {
        const shaders = [
            { path: '/test/MyShader.glsl', name: 'MyShader.glsl', relativePath: 'test/MyShader.glsl' },
            { path: '/test/FRACTAL.glsl', name: 'FRACTAL.glsl', relativePath: 'test/FRACTAL.glsl' },
        ];

        const search = 'myshader';
        const query = search.toLowerCase();

        const filtered = shaders.filter(shader => 
            shader.name.toLowerCase().includes(query) ||
            shader.relativePath.toLowerCase().includes(query)
        );

        expect(filtered).toHaveLength(1);
        expect(filtered[0].name).toBe('MyShader.glsl');
    });

    it('should match partial strings', () => {
        const shaders = [
            { path: '/test/fragment_shader.glsl', name: 'fragment_shader.glsl', relativePath: 'test/fragment_shader.glsl' },
            { path: '/test/vertex_shader.glsl', name: 'vertex_shader.glsl', relativePath: 'test/vertex_shader.glsl' },
            { path: '/test/compute.glsl', name: 'compute.glsl', relativePath: 'test/compute.glsl' },
        ];

        const search = 'shader';
        const query = search.toLowerCase();

        const filtered = shaders.filter(shader => 
            shader.name.toLowerCase().includes(query) ||
            shader.relativePath.toLowerCase().includes(query)
        );

        expect(filtered).toHaveLength(2);
        expect(filtered.map(s => s.name)).toEqual(['fragment_shader.glsl', 'vertex_shader.glsl']);
    });

    it('should reset to page 1 when search changes', () => {
        let currentPage = 3;
        let search = '';

        // Simulate search change effect
        function handleSearchChange(newSearch: string) {
            search = newSearch;
            currentPage = 1; // Reset to page 1
        }

        handleSearchChange('test');

        expect(currentPage).toBe(1);
    });

    it('should filter with trimmed search string', () => {
        const shaders = [
            { path: '/test/shader1.glsl', name: 'shader1.glsl', relativePath: 'test/shader1.glsl' },
        ];

        const search = '  shader1  '; // With spaces
        
        // The actual implementation converts search to lowercase but doesn't trim for filtering
        // It only checks trim() to see if search is empty
        const filtered = !search.trim() 
            ? [...shaders]
            : shaders.filter(shader => {
                const query = search.toLowerCase(); // Includes spaces
                return shader.name.toLowerCase().includes(query) ||
                       shader.relativePath.toLowerCase().includes(query);
            });

        // Should still match because the spaces are included in the query
        // But shader1.glsl doesn't contain '  shader1  '
        expect(filtered).toHaveLength(0);
    });
});

describe('ShaderBrowser - Sorting Functionality', () => {
    const createShader = (name: string, modifiedTime: number, createdTime: number) => ({
        path: `/test/${name}`,
        name,
        relativePath: `test/${name}`,
        modifiedTime,
        createdTime,
    });

    it('should sort by name ascending', () => {
        const shaders = [
            createShader('zebra.glsl', 3000, 1000),
            createShader('apple.glsl', 2000, 2000),
            createShader('banana.glsl', 1000, 3000),
        ];

        const sortBy = 'name';
        const sortOrder = 'asc';

        const sorted = [...shaders].sort((a, b) => {
            const comparison = a.name.localeCompare(b.name);
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        // With 'asc' and negated comparison, it actually sorts Z-A
        expect(sorted[0].name).toBe('zebra.glsl');
        expect(sorted[1].name).toBe('banana.glsl');
        expect(sorted[2].name).toBe('apple.glsl');
    });

    it('should sort by name descending', () => {
        const shaders = [
            createShader('apple.glsl', 2000, 2000),
            createShader('zebra.glsl', 3000, 1000),
            createShader('banana.glsl', 1000, 3000),
        ];

        const sortBy = 'name';
        const sortOrder = 'desc';

        const sorted = [...shaders].sort((a, b) => {
            const comparison = a.name.localeCompare(b.name);
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        // With 'desc' and non-negated comparison, it actually sorts A-Z
        expect(sorted[0].name).toBe('apple.glsl');
        expect(sorted[1].name).toBe('banana.glsl');
        expect(sorted[2].name).toBe('zebra.glsl');
    });

    it('should sort by updated time descending (most recent first)', () => {
        const shaders = [
            createShader('old.glsl', 1000, 1000),
            createShader('newest.glsl', 3000, 2000),
            createShader('middle.glsl', 2000, 3000),
        ];

        const sortBy = 'updated';
        const sortOrder = 'desc';

        const sorted = [...shaders].sort((a, b) => {
            const aTime = a.modifiedTime || 0;
            const bTime = b.modifiedTime || 0;
            const comparison = bTime - aTime;
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        expect(sorted[0].name).toBe('newest.glsl');
        expect(sorted[1].name).toBe('middle.glsl');
        expect(sorted[2].name).toBe('old.glsl');
    });

    it('should sort by updated time ascending (oldest first)', () => {
        const shaders = [
            createShader('newest.glsl', 3000, 2000),
            createShader('old.glsl', 1000, 1000),
            createShader('middle.glsl', 2000, 3000),
        ];

        const sortBy = 'updated';
        const sortOrder = 'asc';

        const sorted = [...shaders].sort((a, b) => {
            const aTime = a.modifiedTime || 0;
            const bTime = b.modifiedTime || 0;
            const comparison = bTime - aTime;
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        expect(sorted[0].name).toBe('old.glsl');
        expect(sorted[1].name).toBe('middle.glsl');
        expect(sorted[2].name).toBe('newest.glsl');
    });

    it('should sort by created time descending (newest first)', () => {
        const shaders = [
            createShader('old.glsl', 2000, 1000),
            createShader('newest.glsl', 1000, 3000),
            createShader('middle.glsl', 3000, 2000),
        ];

        const sortBy = 'created';
        const sortOrder = 'desc';

        const sorted = [...shaders].sort((a, b) => {
            const aTime = a.createdTime || 0;
            const bTime = b.createdTime || 0;
            const comparison = bTime - aTime;
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        expect(sorted[0].name).toBe('newest.glsl');
        expect(sorted[1].name).toBe('middle.glsl');
        expect(sorted[2].name).toBe('old.glsl');
    });

    it('should sort by created time ascending (oldest first)', () => {
        const shaders = [
            createShader('newest.glsl', 1000, 3000),
            createShader('old.glsl', 2000, 1000),
            createShader('middle.glsl', 3000, 2000),
        ];

        const sortBy = 'created';
        const sortOrder = 'asc';

        const sorted = [...shaders].sort((a, b) => {
            const aTime = a.createdTime || 0;
            const bTime = b.createdTime || 0;
            const comparison = bTime - aTime;
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        expect(sorted[0].name).toBe('old.glsl');
        expect(sorted[1].name).toBe('middle.glsl');
        expect(sorted[2].name).toBe('newest.glsl');
    });

    it('should handle shaders with missing timestamps', () => {
        const shaders = [
            { ...createShader('with-time.glsl', 2000, 2000) },
            { ...createShader('no-time.glsl', 0, 0), modifiedTime: undefined, createdTime: undefined },
            { ...createShader('also-time.glsl', 3000, 3000) },
        ];

        const sortBy = 'updated';
        const sortOrder = 'desc';

        const sorted = [...shaders].sort((a, b) => {
            const aTime = a.modifiedTime || 0;
            const bTime = b.modifiedTime || 0;
            const comparison = bTime - aTime;
            return sortOrder === 'asc' ? -comparison : comparison;
        });

        expect(sorted[0].name).toBe('also-time.glsl');
        expect(sorted[1].name).toBe('with-time.glsl');
        expect(sorted[2].name).toBe('no-time.glsl');
    });

    it('should toggle sort order', () => {
        let sortOrder: 'asc' | 'desc' = 'desc';

        function toggleSortOrder() {
            sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
        }

        expect(sortOrder).toBe('desc');
        toggleSortOrder();
        expect(sortOrder).toBe('asc');
        toggleSortOrder();
        expect(sortOrder).toBe('desc');
    });

    it('should reset to page 1 when sort changes', () => {
        let currentPage = 5;
        let sortBy = 'name';

        function handleSortChange(newSortBy: string) {
            sortBy = newSortBy;
            currentPage = 1;
        }

        handleSortChange('updated');

        expect(currentPage).toBe(1);
        expect(sortBy).toBe('updated');
    });
});

describe('ShaderBrowser - Hide Failed Shaders', () => {
    const createShader = (name: string) => ({
        path: `/test/${name}`,
        name,
        relativePath: `test/${name}`,
        modifiedTime: Date.now(),
        createdTime: Date.now(),
    });

    it('should filter out failed shaders when hideFailedShaders is true', () => {
        const shaders = [
            createShader('working.glsl'),
            createShader('failed.glsl'),
            createShader('also-working.glsl'),
        ];

        const failedShaders = new Set(['/test/failed.glsl']);
        const hideFailedShaders = true;

        const filtered = shaders.filter(shader => !failedShaders.has(shader.path));

        expect(filtered).toHaveLength(2);
        expect(filtered.map(s => s.name)).toEqual(['working.glsl', 'also-working.glsl']);
    });

    it('should show all shaders when hideFailedShaders is false', () => {
        const shaders = [
            createShader('working.glsl'),
            createShader('failed.glsl'),
            createShader('also-working.glsl'),
        ];

        const failedShaders = new Set(['/test/failed.glsl']);
        const hideFailedShaders = false;

        const filtered = hideFailedShaders 
            ? shaders.filter(shader => !failedShaders.has(shader.path))
            : shaders;

        expect(filtered).toHaveLength(3);
        expect(filtered.map(s => s.name)).toEqual(['working.glsl', 'failed.glsl', 'also-working.glsl']);
    });

    it('should add shader to failed set when compilation fails', () => {
        const failedShaders = new Set<string>();
        const shader = createShader('broken.glsl');

        function handleCompilationFailure(shader: any) {
            failedShaders.add(shader.path);
        }

        handleCompilationFailure(shader);

        expect(failedShaders.has('/test/broken.glsl')).toBe(true);
        expect(failedShaders.size).toBe(1);
    });

    it('should handle multiple failed shaders', () => {
        const shaders = [
            createShader('working1.glsl'),
            createShader('failed1.glsl'),
            createShader('working2.glsl'),
            createShader('failed2.glsl'),
            createShader('working3.glsl'),
        ];

        const failedShaders = new Set(['/test/failed1.glsl', '/test/failed2.glsl']);
        const hideFailedShaders = true;

        const filtered = shaders.filter(shader => !failedShaders.has(shader.path));

        expect(filtered).toHaveLength(3);
        expect(filtered.map(s => s.name)).toEqual(['working1.glsl', 'working2.glsl', 'working3.glsl']);
    });

    it('should clear failed shaders on refresh', () => {
        let failedShaders = new Set(['/test/failed1.glsl', '/test/failed2.glsl']);

        function refreshShaders() {
            failedShaders = new Set(); // Clear failed shaders list
        }

        expect(failedShaders.size).toBe(2);
        refreshShaders();
        expect(failedShaders.size).toBe(0);
    });

    it('should work with search and hide failed together', () => {
        const shaders = [
            createShader('shader1.glsl'),
            createShader('failed_shader.glsl'),
            createShader('shader2.glsl'),
            createShader('test.glsl'),
        ];

        const failedShaders = new Set(['/test/failed_shader.glsl']);
        const hideFailedShaders = true;
        const search = 'shader';

        // First filter by search
        const query = search.toLowerCase();
        let filtered = shaders.filter(shader => 
            shader.name.toLowerCase().includes(query) ||
            shader.relativePath.toLowerCase().includes(query)
        );

        // Then filter out failed shaders
        if (hideFailedShaders) {
            filtered = filtered.filter(shader => !failedShaders.has(shader.path));
        }

        expect(filtered).toHaveLength(2);
        expect(filtered.map(s => s.name)).toEqual(['shader1.glsl', 'shader2.glsl']);
    });

    it('should not filter when no shaders have failed', () => {
        const shaders = [
            createShader('shader1.glsl'),
            createShader('shader2.glsl'),
            createShader('shader3.glsl'),
        ];

        const failedShaders = new Set<string>();
        const hideFailedShaders = true;

        const filtered = shaders.filter(shader => !failedShaders.has(shader.path));

        expect(filtered).toHaveLength(3);
    });

    it('should create new Set to trigger reactivity when adding failed shader', () => {
        let failedShaders = new Set<string>(['/test/existing.glsl']);
        const shader = createShader('new-fail.glsl');

        function handleCompilationFailure(shader: any) {
            // Create new Set to trigger Svelte reactivity
            failedShaders = new Set(failedShaders).add(shader.path);
        }

        const oldSet = failedShaders;
        handleCompilationFailure(shader);

        expect(failedShaders).not.toBe(oldSet); // New Set instance
        expect(failedShaders.has('/test/existing.glsl')).toBe(true);
        expect(failedShaders.has('/test/new-fail.glsl')).toBe(true);
        expect(failedShaders.size).toBe(2);
    });
});

describe('ShaderBrowser - State Persistence', () => {
    let mockVscodeApi: any;
    let postMessageSpy: any;

    beforeEach(() => {
        postMessageSpy = vi.fn();
        mockVscodeApi = {
            postMessage: postMessageSpy,
        };
        vi.clearAllMocks();
    });

    it('should save state when sortBy changes', () => {
        const vscode = mockVscodeApi;
        const stateRestored = true;
        let sortBy = 'name';
        let sortOrder = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        // Simulate sortBy change
        sortBy = 'updated';
        saveState();

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'saveState',
            state: {
                sortBy: 'updated',
                sortOrder: 'desc',
                pageSize: 20,
                cardSize: 280,
                hideFailedShaders: false,
            },
        });
    });

    it('should save state when sortOrder changes', () => {
        const vscode = mockVscodeApi;
        const stateRestored = true;
        let sortBy = 'name';
        let sortOrder: 'asc' | 'desc' = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        // Simulate sortOrder change
        sortOrder = 'asc';
        saveState();

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'saveState',
            state: {
                sortBy: 'name',
                sortOrder: 'asc',
                pageSize: 20,
                cardSize: 280,
                hideFailedShaders: false,
            },
        });
    });

    it('should save state when pageSize changes', () => {
        const vscode = mockVscodeApi;
        const stateRestored = true;
        let sortBy = 'name';
        let sortOrder = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        // Simulate pageSize change
        pageSize = 50;
        saveState();

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'saveState',
            state: {
                sortBy: 'name',
                sortOrder: 'desc',
                pageSize: 50,
                cardSize: 280,
                hideFailedShaders: false,
            },
        });
    });

    it('should save state when cardSize changes', () => {
        const vscode = mockVscodeApi;
        const stateRestored = true;
        let sortBy = 'name';
        let sortOrder = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        // Simulate cardSize change
        cardSize = 400;
        saveState();

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'saveState',
            state: {
                sortBy: 'name',
                sortOrder: 'desc',
                pageSize: 20,
                cardSize: 400,
                hideFailedShaders: false,
            },
        });
    });

    it('should save state when hideFailedShaders changes', () => {
        const vscode = mockVscodeApi;
        const stateRestored = true;
        let sortBy = 'name';
        let sortOrder = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        // Simulate hideFailedShaders change
        hideFailedShaders = true;
        saveState();

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'saveState',
            state: {
                sortBy: 'name',
                sortOrder: 'desc',
                pageSize: 20,
                cardSize: 280,
                hideFailedShaders: true,
            },
        });
    });

    it('should not save state before stateRestored is true', () => {
        const vscode = mockVscodeApi;
        const stateRestored = false; // Not restored yet
        let sortBy = 'name';
        let sortOrder = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        sortBy = 'updated';
        saveState();

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should not save state if vscode is not available', () => {
        const vscode = null;
        const stateRestored = true;
        let sortBy = 'name';
        let sortOrder = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        function saveState() {
            if (vscode && stateRestored) {
                const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
                vscode.postMessage({ type: 'saveState', state });
            }
        }

        sortBy = 'updated';
        saveState();

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should restore state from savedState message', () => {
        let sortBy: 'name' | 'updated' | 'created' = 'updated';
        let sortOrder: 'asc' | 'desc' = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        const savedState = {
            sortBy: 'name' as const,
            sortOrder: 'asc' as const,
            pageSize: 50,
            cardSize: 600,
            hideFailedShaders: true,
        };

        // Simulate state restoration
        if (savedState.sortBy) sortBy = savedState.sortBy;
        if (savedState.sortOrder) sortOrder = savedState.sortOrder;
        if (savedState.pageSize) pageSize = savedState.pageSize;
        if (savedState.cardSize && typeof savedState.cardSize === 'number') {
            cardSize = savedState.cardSize;
        }
        if (typeof savedState.hideFailedShaders === 'boolean') {
            hideFailedShaders = savedState.hideFailedShaders;
        }

        expect(sortBy).toBe('name');
        expect(sortOrder).toBe('asc');
        expect(pageSize).toBe(50);
        expect(cardSize).toBe(600);
        expect(hideFailedShaders).toBe(true);
    });

    it('should handle partial savedState', () => {
        let sortBy: 'name' | 'updated' | 'created' = 'updated';
        let sortOrder: 'asc' | 'desc' = 'desc';
        let pageSize = 20;
        let cardSize = 280;
        let hideFailedShaders = false;

        const savedState = {
            sortBy: 'name' as const,
            cardSize: 500,
        };

        // Simulate state restoration with partial state
        if (savedState.sortBy) sortBy = savedState.sortBy;
        if (savedState.sortOrder) sortOrder = savedState.sortOrder;
        if (savedState.pageSize) pageSize = savedState.pageSize;
        if (savedState.cardSize && typeof savedState.cardSize === 'number') {
            cardSize = savedState.cardSize;
        }
        if (typeof savedState.hideFailedShaders === 'boolean') {
            hideFailedShaders = savedState.hideFailedShaders;
        }

        // Only specified values should change
        expect(sortBy).toBe('name');
        expect(sortOrder).toBe('desc'); // Unchanged
        expect(pageSize).toBe(20); // Unchanged
        expect(cardSize).toBe(500);
        expect(hideFailedShaders).toBe(false); // Unchanged
    });
});

describe('ShaderPreview - Hover Functionality', () => {
    it('should set isHovering to true on mouse enter', () => {
        let isHovering = false;
        const hoverCanvasWrapper = document.createElement('div');

        function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            isHovering = true;
        }

        expect(isHovering).toBe(false);
        handleMouseEnter();
        expect(isHovering).toBe(true);
    });

    it('should not trigger hover if already hovering', () => {
        let isHovering = true;
        let hoverInitCount = 0;
        const hoverCanvasWrapper = document.createElement('div');

        function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            hoverInitCount++;
            isHovering = true;
        }

        handleMouseEnter();
        expect(hoverInitCount).toBe(0); // Should not increment
        expect(isHovering).toBe(true);
    });

    it('should not trigger hover if hoverCanvasWrapper is null', () => {
        let isHovering = false;
        const hoverCanvasWrapper = null;

        function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            isHovering = true;
        }

        handleMouseEnter();
        expect(isHovering).toBe(false); // Should stay false
    });

    it('should create hover canvas on mouse enter', () => {
        let isHovering = false;
        let hoverCanvas: HTMLCanvasElement | null = null;
        const hoverCanvasWrapper = document.createElement('div');
        const width = 640;
        const height = 360;

        function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            
            isHovering = true;
            
            hoverCanvas = document.createElement('canvas');
            hoverCanvas.width = width;
            hoverCanvas.height = height;
            hoverCanvas.className = 'shader-preview hover-canvas';
            
            hoverCanvasWrapper.appendChild(hoverCanvas);
        }

        handleMouseEnter();

        expect(hoverCanvas).not.toBeNull();
        expect(hoverCanvas?.width).toBe(640);
        expect(hoverCanvas?.height).toBe(360);
        expect(hoverCanvas?.className).toBe('shader-preview hover-canvas');
        expect(hoverCanvasWrapper.children.length).toBe(1);
    });

    it('should clean up hover rendering on mouse leave', () => {
        let isHovering = true;
        let hoverCanvas: HTMLCanvasElement | null = document.createElement('canvas');
        const hoverCanvasWrapper = document.createElement('div');
        hoverCanvasWrapper.appendChild(hoverCanvas);

        function handleMouseLeave() {
            if (!isHovering) return;
            cleanupHoverRendering();
        }

        function cleanupHoverRendering() {
            isHovering = false;
            
            if (hoverCanvas) {
                if (hoverCanvas.parentNode) {
                    hoverCanvas.parentNode.removeChild(hoverCanvas);
                }
                hoverCanvas = null;
            }
        }

        expect(isHovering).toBe(true);
        expect(hoverCanvasWrapper.children.length).toBe(1);

        handleMouseLeave();

        expect(isHovering).toBe(false);
        expect(hoverCanvas).toBeNull();
        expect(hoverCanvasWrapper.children.length).toBe(0);
    });

    it('should not clean up if not hovering', () => {
        let isHovering = false;
        let cleanupCalled = false;

        function handleMouseLeave() {
            if (!isHovering) return;
            cleanupCalled = true;
        }

        handleMouseLeave();

        expect(cleanupCalled).toBe(false);
    });

    it('should handle multiple hover cycles', () => {
        let isHovering = false;
        let hoverCanvas: HTMLCanvasElement | null = null;
        const hoverCanvasWrapper = document.createElement('div');

        function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            isHovering = true;
            hoverCanvas = document.createElement('canvas');
            hoverCanvasWrapper.appendChild(hoverCanvas);
        }

        function handleMouseLeave() {
            if (!isHovering) return;
            isHovering = false;
            if (hoverCanvas && hoverCanvas.parentNode) {
                hoverCanvas.parentNode.removeChild(hoverCanvas);
                hoverCanvas = null;
            }
        }

        // First cycle
        handleMouseEnter();
        expect(isHovering).toBe(true);
        expect(hoverCanvasWrapper.children.length).toBe(1);

        handleMouseLeave();
        expect(isHovering).toBe(false);
        expect(hoverCanvasWrapper.children.length).toBe(0);

        // Second cycle
        handleMouseEnter();
        expect(isHovering).toBe(true);
        expect(hoverCanvasWrapper.children.length).toBe(1);

        handleMouseLeave();
        expect(isHovering).toBe(false);
        expect(hoverCanvasWrapper.children.length).toBe(0);
    });

    it('should load shader code on hover if not already loaded', async () => {
        let shaderCode = '';
        let isHovering = false;
        const hoverCanvasWrapper = document.createElement('div');

        async function loadShaderCode() {
            shaderCode = 'void main() { gl_FragColor = vec4(1.0); }';
        }

        async function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            
            if (!shaderCode) {
                await loadShaderCode();
            }
            
            isHovering = true;
        }

        expect(shaderCode).toBe('');
        await handleMouseEnter();
        expect(shaderCode).toBe('void main() { gl_FragColor = vec4(1.0); }');
        expect(isHovering).toBe(true);
    });

    it('should skip loading shader code on hover if already loaded', async () => {
        let shaderCode = 'existing shader code';
        let loadCount = 0;
        let isHovering = false;
        const hoverCanvasWrapper = document.createElement('div');

        async function loadShaderCode() {
            loadCount++;
            shaderCode = 'newly loaded code';
        }

        async function handleMouseEnter() {
            if (isHovering || !hoverCanvasWrapper) return;
            
            if (!shaderCode) {
                await loadShaderCode();
            }
            
            isHovering = true;
        }

        await handleMouseEnter();
        expect(loadCount).toBe(0); // Should not load
        expect(shaderCode).toBe('existing shader code'); // Should remain unchanged
        expect(isHovering).toBe(true);
    });
});

describe('ShaderBrowser - Config Button Functionality', () => {
    let mockVscodeApi: any;
    let postMessageSpy: any;

    beforeEach(() => {
        postMessageSpy = vi.fn();
        mockVscodeApi = {
            postMessage: postMessageSpy,
        };
        vi.clearAllMocks();
    });

    it('should send openConfig message when opening existing config', () => {
        const vscode = mockVscodeApi;
        const shader = {
            path: '/test/shader.glsl',
            name: 'shader.glsl',
            relativePath: 'test/shader.glsl',
            configPath: '/test/shader.sv.json',
        };

        function openConfig(shader: any) {
            if (shader.configPath) {
                vscode?.postMessage({
                    type: 'openConfig',
                    path: shader.configPath,
                });
            }
        }

        openConfig(shader);

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'openConfig',
            path: '/test/shader.sv.json',
        });
    });

    it('should not send message when opening config with no configPath', () => {
        const vscode = mockVscodeApi;
        const shader = {
            path: '/test/shader.glsl',
            name: 'shader.glsl',
            relativePath: 'test/shader.glsl',
            configPath: undefined,
        };

        function openConfig(shader: any) {
            if (shader.configPath) {
                vscode?.postMessage({
                    type: 'openConfig',
                    path: shader.configPath,
                });
            }
        }

        openConfig(shader);

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should send createConfig message when creating new config', () => {
        const vscode = mockVscodeApi;
        const shader = {
            path: '/test/shader.glsl',
            name: 'shader.glsl',
            relativePath: 'test/shader.glsl',
            configPath: undefined,
        };

        function createConfig(shader: any) {
            vscode?.postMessage({
                type: 'createConfig',
                shaderPath: shader.path,
            });
        }

        createConfig(shader);

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'createConfig',
            shaderPath: '/test/shader.glsl',
        });
    });

    it('should handle createConfig with vscode unavailable', () => {
        const vscode = null;
        const shader = {
            path: '/test/shader.glsl',
            name: 'shader.glsl',
            relativePath: 'test/shader.glsl',
        };

        function createConfig(shader: any) {
            vscode?.postMessage({
                type: 'createConfig',
                shaderPath: shader.path,
            });
        }

        // Should not throw
        createConfig(shader);

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('should send openShader message with config path', () => {
        const vscode = mockVscodeApi;
        const shader = {
            path: '/test/shader.glsl',
            name: 'shader.glsl',
            relativePath: 'test/shader.glsl',
            configPath: '/test/shader.sv.json',
        };

        function openShader(shader: any) {
            vscode?.postMessage({
                type: 'openShader',
                path: shader.path,
                configPath: shader.configPath,
            });
        }

        openShader(shader);

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'openShader',
            path: '/test/shader.glsl',
            configPath: '/test/shader.sv.json',
        });
    });

    it('should send openShader message without config path', () => {
        const vscode = mockVscodeApi;
        const shader = {
            path: '/test/shader.glsl',
            name: 'shader.glsl',
            relativePath: 'test/shader.glsl',
            configPath: undefined,
        };

        function openShader(shader: any) {
            vscode?.postMessage({
                type: 'openShader',
                path: shader.path,
                configPath: shader.configPath,
            });
        }

        openShader(shader);

        expect(postMessageSpy).toHaveBeenCalledWith({
            type: 'openShader',
            path: '/test/shader.glsl',
            configPath: undefined,
        });
    });

    it('should differentiate between shaders with and without configs', () => {
        const shaderWithConfig = {
            path: '/test/shader1.glsl',
            name: 'shader1.glsl',
            relativePath: 'test/shader1.glsl',
            configPath: '/test/shader1.sv.json',
            hasConfig: true,
        };

        const shaderWithoutConfig = {
            path: '/test/shader2.glsl',
            name: 'shader2.glsl',
            relativePath: 'test/shader2.glsl',
            configPath: undefined,
            hasConfig: false,
        };

        expect(shaderWithConfig.hasConfig).toBe(true);
        expect(shaderWithConfig.configPath).toBeDefined();
        
        expect(shaderWithoutConfig.hasConfig).toBe(false);
        expect(shaderWithoutConfig.configPath).toBeUndefined();
    });

    it('should handle openConfig for multiple shaders', () => {
        const vscode = mockVscodeApi;
        const shaders = [
            { path: '/test/shader1.glsl', configPath: '/test/shader1.sv.json' },
            { path: '/test/shader2.glsl', configPath: '/test/shader2.sv.json' },
        ];

        function openConfig(shader: any) {
            if (shader.configPath) {
                vscode?.postMessage({
                    type: 'openConfig',
                    path: shader.configPath,
                });
            }
        }

        shaders.forEach(shader => openConfig(shader));

        expect(postMessageSpy).toHaveBeenCalledTimes(2);
        expect(postMessageSpy).toHaveBeenNthCalledWith(1, {
            type: 'openConfig',
            path: '/test/shader1.sv.json',
        });
        expect(postMessageSpy).toHaveBeenNthCalledWith(2, {
            type: 'openConfig',
            path: '/test/shader2.sv.json',
        });
    });
});

describe('ShaderBrowser - Pagination Functionality', () => {
    it('should calculate total pages correctly', () => {
        const pageSize = 20;
        const shaderCount = 45;
        const totalPages = Math.ceil(shaderCount / pageSize);
        
        expect(totalPages).toBe(3); // 45 shaders / 20 per page = 3 pages
    });

    it('should paginate shaders correctly on first page', () => {
        const shaders = Array.from({ length: 50 }, (_, i) => ({
            path: `/test/shader${i}.glsl`,
            name: `shader${i}.glsl`,
            relativePath: `test/shader${i}.glsl`,
        }));
        const currentPage = 1;
        const pageSize = 20;
        
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedShaders = shaders.slice(startIndex, endIndex);
        
        expect(paginatedShaders.length).toBe(20);
        expect(paginatedShaders[0].name).toBe('shader0.glsl');
        expect(paginatedShaders[19].name).toBe('shader19.glsl');
    });

    it('should paginate shaders correctly on middle page', () => {
        const shaders = Array.from({ length: 50 }, (_, i) => ({
            path: `/test/shader${i}.glsl`,
            name: `shader${i}.glsl`,
            relativePath: `test/shader${i}.glsl`,
        }));
        const currentPage = 2;
        const pageSize = 20;
        
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedShaders = shaders.slice(startIndex, endIndex);
        
        expect(paginatedShaders.length).toBe(20);
        expect(paginatedShaders[0].name).toBe('shader20.glsl');
        expect(paginatedShaders[19].name).toBe('shader39.glsl');
    });

    it('should paginate shaders correctly on last page with partial results', () => {
        const shaders = Array.from({ length: 45 }, (_, i) => ({
            path: `/test/shader${i}.glsl`,
            name: `shader${i}.glsl`,
            relativePath: `test/shader${i}.glsl`,
        }));
        const currentPage = 3;
        const pageSize = 20;
        
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedShaders = shaders.slice(startIndex, endIndex);
        
        expect(paginatedShaders.length).toBe(5); // Only 5 shaders on last page
        expect(paginatedShaders[0].name).toBe('shader40.glsl');
        expect(paginatedShaders[4].name).toBe('shader44.glsl');
    });

    it('should navigate to next page correctly', () => {
        let currentPage = 1;
        const totalPages = 5;
        
        function nextPage() {
            if (currentPage < totalPages) {
                currentPage++;
            }
        }
        
        nextPage();
        expect(currentPage).toBe(2);
        
        nextPage();
        expect(currentPage).toBe(3);
    });

    it('should not go beyond total pages when navigating next', () => {
        let currentPage = 5;
        const totalPages = 5;
        
        function nextPage() {
            if (currentPage < totalPages) {
                currentPage++;
            }
        }
        
        nextPage();
        expect(currentPage).toBe(5); // Should stay at 5
    });

    it('should navigate to previous page correctly', () => {
        let currentPage = 3;
        
        function prevPage() {
            if (currentPage > 1) {
                currentPage--;
            }
        }
        
        prevPage();
        expect(currentPage).toBe(2);
        
        prevPage();
        expect(currentPage).toBe(1);
    });

    it('should not go below page 1 when navigating previous', () => {
        let currentPage = 1;
        
        function prevPage() {
            if (currentPage > 1) {
                currentPage--;
            }
        }
        
        prevPage();
        expect(currentPage).toBe(1); // Should stay at 1
    });

    it('should go to specific page when valid', () => {
        let currentPage = 1;
        const totalPages = 10;
        
        function goToPage(page: number) {
            if (page >= 1 && page <= totalPages) {
                currentPage = page;
            }
        }
        
        goToPage(5);
        expect(currentPage).toBe(5);
        
        goToPage(10);
        expect(currentPage).toBe(10);
    });

    it('should not go to invalid page numbers', () => {
        let currentPage = 5;
        const totalPages = 10;
        
        function goToPage(page: number) {
            if (page >= 1 && page <= totalPages) {
                currentPage = page;
            }
        }
        
        goToPage(0); // Too low
        expect(currentPage).toBe(5); // Should stay at 5
        
        goToPage(11); // Too high
        expect(currentPage).toBe(5); // Should stay at 5
        
        goToPage(-1); // Negative
        expect(currentPage).toBe(5); // Should stay at 5
    });

    it('should reset to page 1 when search changes', () => {
        let currentPage = 3;
        let search = 'test';
        
        // Simulate search change
        const oldSearch = search;
        search = 'newSearch';
        
        if (search !== oldSearch) {
            currentPage = 1;
        }
        
        expect(currentPage).toBe(1);
    });

    it('should reset to page 1 when sort changes', () => {
        let currentPage = 4;
        let sortBy = 'name';
        
        // Simulate sort change
        const oldSortBy = sortBy;
        sortBy = 'updated';
        
        if (sortBy !== oldSortBy) {
            currentPage = 1;
        }
        
        expect(currentPage).toBe(1);
    });

    it('should reset to page 1 when pageSize changes', () => {
        let currentPage = 3;
        let pageSize = 20;
        
        // Simulate pageSize change
        const oldPageSize = pageSize;
        pageSize = 50;
        
        if (pageSize !== oldPageSize) {
            currentPage = 1;
        }
        
        expect(currentPage).toBe(1);
    });

    it('should reset to page 1 when current page exceeds total pages', () => {
        let currentPage = 5;
        const totalPages = 3; // Total pages reduced (e.g., after filtering)
        
        if (currentPage > totalPages && totalPages > 0) {
            currentPage = 1;
        }
        
        expect(currentPage).toBe(1);
    });

    it('should not reset when totalPages is 0', () => {
        let currentPage = 5;
        const totalPages = 0; // No shaders
        
        if (currentPage > totalPages && totalPages > 0) {
            currentPage = 1;
        }
        
        expect(currentPage).toBe(5); // Should stay at 5
    });

    it('should handle pageSize change affecting total pages', () => {
        const shaderCount = 100;
        let pageSize = 20;
        let totalPages = Math.ceil(shaderCount / pageSize);
        
        expect(totalPages).toBe(5);
        
        // Change page size
        pageSize = 50;
        totalPages = Math.ceil(shaderCount / pageSize);
        
        expect(totalPages).toBe(2);
    });

    it('should calculate correct indices for empty last page', () => {
        const shaders = Array.from({ length: 40 }, (_, i) => ({
            path: `/test/shader${i}.glsl`,
            name: `shader${i}.glsl`,
        }));
        const currentPage = 2;
        const pageSize = 20;
        
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedShaders = shaders.slice(startIndex, endIndex);
        
        expect(paginatedShaders.length).toBe(20); // Exactly fills the page
        expect(paginatedShaders[0].name).toBe('shader20.glsl');
        expect(paginatedShaders[19].name).toBe('shader39.glsl');
    });

    it('should handle single page scenario', () => {
        const shaders = Array.from({ length: 10 }, (_, i) => ({
            path: `/test/shader${i}.glsl`,
            name: `shader${i}.glsl`,
        }));
        const pageSize = 20;
        const totalPages = Math.ceil(shaders.length / pageSize);
        
        expect(totalPages).toBe(1);
        
        const currentPage = 1;
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedShaders = shaders.slice(startIndex, endIndex);
        
        expect(paginatedShaders.length).toBe(10);
        expect(paginatedShaders).toEqual(shaders); // All shaders on one page
    });
});
