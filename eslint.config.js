import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

export default defineConfig(
    {
        ignores: [
            "dist/",
            "coverage/",
            "node_modules/",
        ],
    },

    eslint.configs.recommended,
    ...tseslint.configs.recommended,

    {
        plugins: {
            "@stylistic": stylistic,
        },
        rules: {
            "@stylistic/indent": ["error", 4],
            "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/no-trailing-spaces": "error",
            "@stylistic/eol-last": ["error", "always"],
            "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0, maxBOF: 0 }],
            "@stylistic/object-curly-spacing": ["error", "always"],
            "@stylistic/comma-spacing": ["error", { before: false, after: true }],
            "@stylistic/key-spacing": ["error", { beforeColon: false, afterColon: true }],
            "@stylistic/space-before-blocks": "error",
            "@stylistic/keyword-spacing": ["error", { before: true, after: true }],
            "@stylistic/space-infix-ops": "error",
            "@stylistic/arrow-spacing": "error",
            "@stylistic/block-spacing": "error",
            "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
            "@stylistic/type-annotation-spacing": "error",
        },
    },

    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
            }],
        },
    },
);
