import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Barcode rendering runs on the server only
  serverExternalPackages: ["bwip-js"],
  // CSV imports are sent to a server action; allow larger files than the 1 MB default
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
