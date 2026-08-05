import { defineConfig } from "vitest/config";

/**
 * Shared Vitest defaults. Packages extend this with
 * `mergeConfig(baseConfig, defineConfig({ ... }))`.
 */
export const baseConfig = defineConfig({
  test: {
    environment: "node",
    globals: false,
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["**/*.config.*", "**/dist/**", "**/.next/**"],
    },
  },
});

export default baseConfig;
