import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // 터널 도메인(dev HMR/Fast Refresh 허용) — hostname만, 포트·스킴 없이
  allowedDevOrigins: ["test.bluepaun.com"],
};

export default nextConfig;
