import sharedPreset from "@stayw/tailwind-config/preset";
import type { Config } from "tailwindcss";

const config: Config = {
  presets: [sharedPreset],
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
};

export default config;
