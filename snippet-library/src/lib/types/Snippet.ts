export interface Snippet {
    name: string;
    prefix: string;
    body: string[];
    description: string;
    call?: string;
    example?: string[];
    category: SnippetCategory;
    isCustom: boolean;
}

export type SnippetCategory =
    | 'sdf-2d'
    | 'sdf-3d'
    | 'math'
    | 'coordinates'
    | 'custom';

export const CATEGORY_ORDER: SnippetCategory[] = [
    'sdf-2d',
    'sdf-3d',
    'math',
    'coordinates',
    'custom',
];

export const CATEGORY_LABELS: Record<SnippetCategory, string> = {
    'sdf-2d': 'SDF 2D',
    'sdf-3d': 'SDF 3D',
    'math': 'Math',
    'coordinates': 'Coordinates',
    'custom': 'Custom',
};
