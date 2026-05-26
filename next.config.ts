import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["recharts"],
  reactStrictMode: false,
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@radix-ui/react-icons',
      '@radix-ui/themes',
    ],
  },
};

export default withNextIntl(nextConfig);
