/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@stayw/ui", "@stayw/auth", "@stayw/ai-automation", "@stayw/database"],
};

module.exports = nextConfig;
