import { nextConfig } from "@stayw/eslint-config/next";

// Module-boundary rule (see CODING_STANDARDS.md): only domain services and
// platform helpers may import @stayw/database directly. Everything else —
// components, schemas, actions, route handlers — goes through those.
const databaseImportBoundary = [
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@stayw/database",
              message:
                "@stayw/database may only be imported from src/domains/*/services/** or src/platform/** — see CODING_STANDARDS.md's module-boundary rule.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/domains/*/services/**/*.{ts,tsx}", "src/platform/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default [...nextConfig, ...databaseImportBoundary];
