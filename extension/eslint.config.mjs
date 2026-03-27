import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    ignores: ["**/vendor/**", "**/node_modules/**", "**/dist/**"],
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
}];
