import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: Dockerfile multi-stage build için gerekli.
  // .next/standalone/ dizini oluşturur — minimal production server içerir.
  // Bu mod olmadan Dockerfile'daki runner aşaması çalışmaz.
  output: "standalone",

  // Type checking ve ESLint EC2 build sırasında OOM'a yol açıyor (t3.micro 1GB RAM).
  // Type safety local geliştirmede ve CI'da korunur — production image build'ini etkilemez.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // allowedDevOrigins: local geliştirmede cross-origin HMR için.
  // ALLOWED_DEV_ORIGINS env ile override edilebilir (virgülle ayrılmış liste).
  // Production'da otomatik boş kalır.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? [],
};

export default nextConfig;
