import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["recharts"],
  reactStrictMode: false,
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

export default withNextIntl(nextConfig);
