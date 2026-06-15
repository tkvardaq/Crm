/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: [
    '@crm/shared',
    '@crm/email-engine',
    '@crm/scraper',
    '@crm/enrichment',
    '@crm/ai-client',
  ],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', '@crm/database'],
  },
};

module.exports = nextConfig;
