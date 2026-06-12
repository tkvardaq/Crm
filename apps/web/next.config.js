/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  transpilePackages: [
    '@crm/shared',
    '@crm/database',
    '@crm/email-engine',
    '@crm/scraper',
    '@crm/enrichment',
    '@crm/ai-client',
  ],
};

module.exports = nextConfig;
