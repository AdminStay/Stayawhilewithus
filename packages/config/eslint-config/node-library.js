import { baseConfig } from "./base.js";

/**
 * ESLint flat config for plain TypeScript packages (no framework).
 * @type {import("eslint").Linter.Config[]}
 */
export const nodeLibraryConfig = [
  ...baseConfig,
  {
    rules: {
      "import/no-default-export": "error",
    },
  },
  {
    // Flat-config / tool-config files are conventionally required to use a default export.
    files: ["eslint.config.js", "vitest.config.ts"],
    rules: {
      "import/no-default-export": "off",
    },
  },
];

export default nodeLibraryConfig;
