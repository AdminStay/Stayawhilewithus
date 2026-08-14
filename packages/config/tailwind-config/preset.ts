import type { Config } from "tailwindcss";

/**
 * Shared Tailwind design tokens for every app/package in the monorepo.
 * Apps consume this via `presets: [require("@stayw/tailwind-config")]`.
 *
 * Palette: warm ivory/cream surfaces (premium hospitality, not a stock
 * admin-dashboard white), a deep forest-green primary accent, and a muted
 * gold secondary accent for highlights/ratings. Status colors are
 * desaturated on purpose — this is an operations product, not a form
 * builder, so red/green/amber stay restrained.
 */
const preset: Omit<Config, "content"> = {
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        ivory: {
          DEFAULT: "#FAF7F1",
          50: "#FDFCFA",
          100: "#FAF7F1",
          200: "#F4EFE5",
          300: "#ECE4D4",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F6F2E9",
          translucent: "rgba(255,255,255,0.72)",
        },
        border: {
          DEFAULT: "#E8E1D3",
          strong: "#D8CEB9",
        },
        ink: {
          DEFAULT: "#241F19",
          muted: "#7A7061",
          faint: "#A39A8B",
        },
        forest: {
          50: "#EEF3EF",
          100: "#D6E2D8",
          400: "#4A6B57",
          500: "#31503E",
          600: "#264331",
          700: "#1C3225",
          900: "#101D16",
        },
        gold: {
          50: "#FBF3E3",
          100: "#F5E3BE",
          400: "#C9963E",
          500: "#B8863B",
          600: "#98702F",
        },
        success: { 50: "#EBF2EC", 500: "#4B7A5B", 600: "#3B6249" },
        warning: { 50: "#FBF1DF", 500: "#B8863B", 600: "#98702F" },
        error: { 50: "#FBEAE7", 500: "#B54A3F", 600: "#963C33" },
        info: { 50: "#EBF1F6", 500: "#5B7A99", 600: "#496279" },

        // Kept for any not-yet-migrated component during the phased
        // rollout; aliases to `forest` so nothing looks broken mid-migration.
        brand: {
          50: "#EEF3EF",
          100: "#D6E2D8",
          500: "#31503E",
          600: "#264331",
          700: "#1C3225",
          900: "#101D16",
        },
      },
      borderRadius: {
        DEFAULT: "0.625rem",
        card: "0.875rem",
        pill: "999px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(36,31,25,0.04), 0 1px 1px rgba(36,31,25,0.03)",
        card: "0 1px 3px rgba(36,31,25,0.05), 0 8px 24px -8px rgba(36,31,25,0.10)",
        "card-hover":
          "0 1px 3px rgba(36,31,25,0.06), 0 12px 32px -8px rgba(36,31,25,0.14)",
        panel:
          "0 1px 2px rgba(36,31,25,0.04), 0 20px 48px -16px rgba(36,31,25,0.16)",
      },
      spacing: {
        "18": "4.5rem",
        "72": "18rem",
        "84": "21rem",
      },
    },
  },
  plugins: [],
};

export default preset;
