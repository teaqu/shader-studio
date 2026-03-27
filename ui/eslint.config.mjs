import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import svelteParser from "svelte-eslint-parser";
import sveltePlugin from "eslint-plugin-svelte";

export default [{
  ignores: ["**/node_modules/**", "**/dist/**"],
}, {
  files: ["**/*.ts"],
}, {
  plugins: {
    "@typescript-eslint": typescriptEslint,
  },

  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },

  rules: {
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
  },
}, {
  files: ["**/*.svelte"],
  plugins: {
    svelte: sveltePlugin,
    "@typescript-eslint": typescriptEslint,
  },

  languageOptions: {
    parser: svelteParser,
    parserOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      extraFileExtensions: [".svelte"],
    },
  },

  rules: {
    "brace-style": ["warn", "1tbs", { allowSingleLine: false }],
    curly: "warn",
    eqeqeq: "warn",
    indent: "off",
    "svelte/indent": ["warn", {
      indent: 2,
      switchCase: 1,
    }],
    "no-throw-literal": "warn",
    semi: "warn",
  },
}];
