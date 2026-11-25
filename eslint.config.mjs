// ESLint 9 flat config. Type-aware rules are left out on purpose: `pnpm
// typecheck` already runs the compiler, and lint stays fast enough for CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.tmp/**", "**/.local/**", "docs/**", "**/*.min.js", "apps/api/assets/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // A byte-order mark or a non-breaking space inside a string is meant.
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }],
    },
  },
  {
    // The server logs through pino. A console call there needs a reason,
    // given in an eslint-disable comment beside it.
    // The password-reset command is a command-line tool that talks to a
    // person at a console, so it is left out.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/admin/**"],
    rules: { "no-console": "error" },
  },
);
