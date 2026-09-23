import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  { ignores: ["dist"] },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 },
      parserOptions: { ecmaVersion: "latest", ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins: { react, "react-hooks": reactHooks, "react-refresh": reactRefresh },
    settings: { react: { version: "detect" } },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // this project's Vite setup uses the automatic JSX runtime -- no `import React` needed per file
      "react/prop-types": "off", // no PropTypes in this project by design -- plain JS, not TypeScript or prop-types
      // A literal apostrophe in JSX text (e.g. "Don't", "You haven't") renders correctly in
      // every browser -- this rule exists for strict HTML-entity purism, not for anything
      // that affects correctness or accessibility. Enforcing it would mean rewriting every
      // natural English contraction in this codebase as &apos; escapes, which makes the
      // source harder to read for zero real benefit -- a deliberate, documented call to
      // disable it, not an unexamined default.
      "react/no-unescaped-entities": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.{js,jsx}", "src/test/**"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, vi: "readonly" } },
  },
];
