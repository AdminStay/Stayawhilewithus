import { baseConfig } from "@stayw/vitest-config/base";
import { mergeConfig } from "vitest/config";

export default mergeConfig(baseConfig, {
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
