import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Everything runs in the browser: the adapters talk to each platform directly
   * and history lives in IndexedDB, so there is no server code left. A static
   * export drops the hosting requirement entirely — any static host will do.
   */
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
