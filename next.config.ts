import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: Dockerfile multi-stage build için gerekli.
  // .next/standalone/ dizini oluşturur — minimal production server içerir.
  // Bu mod olmadan Dockerfile'daki runner aşaması çalışmaz.
  output: "standalone",

  // allowedDevOrigins: sadece local dev ortamında gerekli, production'da boş bırak.
  // Docker/K8s ortamında bu satır etkisizdir ama zarar da vermez.
  allowedDevOrigins: process.env.NODE_ENV === "development" ? ["172.22.208.1"] : [],
};

export default nextConfig;
