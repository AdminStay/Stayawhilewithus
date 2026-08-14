import sharedPreset from "@stayw/tailwind-config/preset";
import type { Config } from "tailwindcss";

const config: Config = {
  presets: [sharedPreset],
  // Must also scan @stayw/ui's source, not just this app's own — Tailwind's
  // JIT only generates CSS for class names it finds in a scanned file.
  // Sidebar.tsx's lg:hidden/lg:translate-x-0 (and any other packages/ui
  // utility class not coincidentally duplicated as a literal string
  // somewhere in this app) were silently never compiled without this: the
  // className strings were correct, the CSS rules for them just didn't
  // exist, so the sidebar was permanently stuck in its off-screen mobile
  // state and the hamburger never hid on desktop.
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
