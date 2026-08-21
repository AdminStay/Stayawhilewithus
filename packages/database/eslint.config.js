import { nodeLibraryConfig } from "@stayw/eslint-config/node-library";

export default [
  ...nodeLibraryConfig,
  {
    // CLI scripts — informational console output is the point.
    files: ["prisma/seed.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Root-level read-only diagnostic scripts (plain Node ESM, not part of
    // the deployed app). typescript-eslint's recommended config disables
    // no-undef for .ts/.tsx/.mts/.cts (TypeScript itself already catches
    // undefined identifiers), which is why the override above never needed
    // to touch it — but .mjs falls outside that glob and gets only
    // js.configs.recommended, which has no globals defined at all, so
    // console/process were flagged as literally undefined.
    files: ["*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly" },
    },
    rules: {
      "no-console": "off",
    },
  },
];
