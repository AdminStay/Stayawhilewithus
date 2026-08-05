import { baseConfig } from "@stayw/vitest-config/base";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [tsconfigPaths()],
    test: {
      setupFiles: ["./vitest.setup.mts"],
    },
  }),
);
