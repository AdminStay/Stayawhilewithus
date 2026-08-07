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
];
