import { baseConfig } from "./base.js";

/**
 * ESLint flat config for Next.js apps. Extends the base config;
 * Next.js's own `eslint-config-next` (core-web-vitals) is applied
 * by the consuming app via `next lint`'s built-in integration.
 * @type {import("eslint").Linter.Config[]}
 */
export const nextConfig = [
  ...baseConfig,
  {
    rules: {
      // Server Components / Server Actions commonly have no default export naming pattern to enforce.
      "import/no-default-export": "off",
    },
  },
  {
    // CommonJS tool config files (next.config.js, postcss.config.js).
    files: ["*.config.js"],
    languageOptions: {
      globals: { module: "writable", require: "readonly", __dirname: "readonly" },
    },
  },
  {
    // Next.js-generated file — not hand-authored, don't lint it.
    ignores: ["next-env.d.ts"],
  },
];

export default nextConfig;
