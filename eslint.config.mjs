import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const runtimeGlobals = {
  Buffer: "readonly",
  Headers: "readonly",
  ReadableStream: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  crypto: "readonly",
  fetch: "readonly",
  process: "readonly",
  setTimeout: "readonly",
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**", "**/coverage/**", "**/src/**/*.js"] },
  {
    languageOptions: {
      globals: runtimeGlobals,
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
