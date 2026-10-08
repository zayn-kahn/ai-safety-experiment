import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Lets a replay build be tested locally without touching the live viewer's build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // On Vercel the site is a read-only replay of exported runs (see web/lib/api.ts); locally it's the full viewer.
  env: { NEXT_PUBLIC_VV_MODE: process.env.VERCEL || process.env.VV_MODE === "replay" ? "replay" : "live" },
  turbopack: { root: resolve(__dirname, "..") },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  devIndicators: false,
};

export default config;
