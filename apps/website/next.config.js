// eslint-disable-next-line @typescript-eslint/no-require-imports -- next.config.js is CommonJS; Prisma's documented Next.js-monorepo workaround requires this exact require() usage.
const { PrismaPlugin } = require("@prisma/nextjs-monorepo-workaround-plugin");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stayw/ui", "@stayw/auth", "@stayw/ai-automation", "@stayw/database"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.plugins = [...config.plugins, new PrismaPlugin()];
    }
    return config;
  },
};

module.exports = nextConfig;
