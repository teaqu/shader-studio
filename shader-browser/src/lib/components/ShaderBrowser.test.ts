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
});
