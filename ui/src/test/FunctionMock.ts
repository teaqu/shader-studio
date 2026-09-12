import type { Mock } from 'vitest';

// These test doubles model callable callbacks with differing signatures, not constructors.
// any preserves their individual mockReturnValue/mockImplementation contracts at call sites.
export type FunctionMock = Mock<(...args: any[]) => any>;
