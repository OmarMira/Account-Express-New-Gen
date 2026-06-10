import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  transpilePackages: ["recharts"],
  reactStrictMode: true,
  serverExternalPackages: ['pdfjs-dist'],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      '@radix-ui/react-icons',
      '@radix-ui/themes',
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default withSentryConfig(nextConfig, {
  org: "tu-organizacion",
  project: "account-express",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});

