import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import svelte from "eslint-plugin-svelte";

// Files that already exceed the `max-lines` error limit. This list may only
// shrink: remove an entry once its file has been split below the limit, and
// never add new ones (split the file instead). Tracked by the code-quality
// epic (split WebGPURenderingEngine, language services/parsers, MenuBar, and
// the ShaderViewer session refactor).
const oversizedFileBaseline = [
  "ui/src/lib/components/ShaderViewer.svelte",
];

// Counted without blank lines and comments. The ~800-line guidance in
// AGENTS.md is a design review trigger; this is the existing lint ceiling.
const MAX_LINES = 1200;

const sharedRules = {
  "brace-style": ["error", "1tbs", { allowSingleLine: false }],
  curly: "error",
  eqeqeq: "error",
  "no-throw-literal": "error",
  "max-lines": ["error", { max: MAX_LINES, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
  complexity: ["warn", 20],
  "no-console": ["warn", { allow: ["warn", "error"] }],
};

const typescriptRules = {
  ...sharedRules,
  "@typescript-eslint/naming-convention": ["error", {
    selector: "import",
    format: ["camelCase", "PascalCase"],
  }],
  "@typescript-eslint/no-explicit-any": "warn",
  // Formatting-only rules stay warnings: some packages (e.g. shader-explorer)
  // use 4-space indentation, and a repo-wide reformat is a separate change.
  indent: ["warn", 2, { SwitchCase: 1 }],
  semi: "warn",
};

const tsFiles = ["**/*.ts", "**/*.mts"];

export default [{
  ignores: [
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/coverage/**",
    "**/.vscode-test/**",
    "**/*.d.ts",
    "**/*.d.mts",
    "extension/ui-dist/**",
    "extension/shader-explorer-dist/**",
    "vendor/**",
    ".worktrees/**",
  ],
}, {
  files: tsFiles,
  plugins: {
    "@typescript-eslint": typescriptEslint,
  },
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: typescriptRules,
}, {
  files: ["**/*.mjs"],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: sharedRules,
},
...svelte.configs["flat/base"],
{
  files: ["**/*.svelte"],
  plugins: {
    "@typescript-eslint": typescriptEslint,
  },
  // flat/base already sets svelte-eslint-parser for .svelte files.
  languageOptions: {
    parserOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  rules: {
    ...sharedRules,
    "@typescript-eslint/no-explicit-any": "warn",
  },
}, {
  // Tests, e2e harnesses and scripts are allowed long suites and console output.
  files: [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/test/**",
    "**/tests/**",
    "**/e2e/**",
    "**/scripts/**",
    "tests/**",
  ],
  rules: {
    "max-lines": "off",
    "max-lines-per-function": "off",
    complexity: "off",
    "no-console": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
}, {
  // Generated files do not benefit from handwritten file-size limits.
  files: ["**/generated/**", "**/*.generated.ts"],
  rules: { "max-lines": "off", "max-lines-per-function": "off", complexity: "off" },
}, {
  files: oversizedFileBaseline,
  rules: {
    "max-lines": "off",
  },
}];
