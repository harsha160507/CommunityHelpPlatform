"use strict";
const js = require("@eslint/js"),
  globals = require("globals");
module.exports = [
  { ignores: ["node_modules/**", ".tmp/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    files: ["frontend/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
];
