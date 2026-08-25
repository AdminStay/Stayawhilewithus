import { baseConfig } from "@stayw/vitest-config/base";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [tsconfigPaths()],
    // Next.js/SWC already compiles this app's JSX with the automatic
    // runtime (no `import React` needed). tsconfig.json's "jsx": "preserve"
    // leaves that transform to the bundler, so Vitest's own esbuild
    // transform needs the same setting explicitly — otherwise it falls
    // back to the classic runtime and throws "React is not defined" for
    // any component test (first added here for NotionListingsSearch.tsx).
    esbuild: {
      jsx: "automatic",
    },
    test: {
      setupFiles: ["./vitest.setup.mts"],
    },
  }),
);
