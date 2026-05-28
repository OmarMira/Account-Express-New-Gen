import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from "@sentry/nextjs";

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
  typescript: {
    ignoreBuildErrors: true,
  },
};

const intlConfig = withNextIntl(nextConfig);

export default withSentryConfig(intlConfig, {
  org: "tu-organizacion",
  project: "account-express",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
