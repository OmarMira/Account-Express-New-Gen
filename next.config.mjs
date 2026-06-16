/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "bcrypt"],
  typescript: {
    ignoreBuildErrors: true,
  }
};
export default nextConfig;
