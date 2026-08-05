import { nodeLibraryConfig } from "@stayw/eslint-config/node-library";

export default [
  ...nodeLibraryConfig,
  {
    // CLI seed script — informational console output is the point.
    files: ["prisma/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
