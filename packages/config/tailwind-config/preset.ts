import type { Config } from "tailwindcss";

/**
 * Shared Tailwind design tokens for every app/package in the monorepo.
 * Apps consume this via `presets: [require("@stayw/tailwind-config")]`.
 */
const preset: Omit<Config, "content"> = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f7ff",
          100: "#dceeff",
          500: "#2f6feb",
          600: "#2358c4",
          700: "#1c469b",
          900: "#122a5e",
        },
      },
      borderRadius: {
        DEFAULT: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default preset;
