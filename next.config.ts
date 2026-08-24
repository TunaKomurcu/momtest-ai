import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: Dockerfile multi-stage build için gerekli.
  // .next/standalone/ dizini oluşturur — minimal production server içerir.
  // Bu mod olmadan Dockerfile'daki runner aşaması çalışmaz.
  output: "standalone",

  // allowedDevOrigins: local geliştirmede cross-origin HMR için.
  // ALLOWED_DEV_ORIGINS env ile override edilebilir (virgülle ayrılmış liste).
  // Production'da otomatik boş kalır.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? [],
};

export default nextConfig;
