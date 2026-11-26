import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright", "pdfjs-dist"],
  poweredByHeader: false,
};

export default nextConfig;
