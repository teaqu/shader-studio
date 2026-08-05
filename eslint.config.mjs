import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const typescriptRules = {
  "@typescript-eslint/naming-convention": ["warn", {
    selector: "import",
    format: ["camelCase", "PascalCase"],
  }],
  "brace-style": ["warn", "1tbs", { allowSingleLine: false }],
  curly: "warn",
  eqeqeq: "warn",
  indent: ["warn", 2, { SwitchCase: 1 }],
  "no-throw-literal": "warn",
  semi: "warn",
};

export default [{
  ignores: [
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/coverage/**",
    "extension/ui-dist/**",
    "extension/shader-explorer-dist/**",
    "vendor/**",
    ".worktrees/**",
  ],
}, {
  files: ["extension/**/*.ts"],
  plugins: {
    "@typescript-eslint": typescriptEslint,
  },
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: typescriptRules,
}];
