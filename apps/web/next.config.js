/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  transpilePackages: [
    '@crm/shared',
    '@crm/email-engine',
    '@crm/scraper',
    '@crm/enrichment',
    '@crm/ai-client',
  ],
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', '@crm/database', 'ioredis', 'bullmq', 'cheerio', 'https-proxy-agent'],
  },
};

module.exports = nextConfig;
