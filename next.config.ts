import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * The short commit SHA this build was produced from, captured at build time and
 * baked into the bundle as process.env.GIT_COMMIT. Prefers an explicit
 * GIT_COMMIT build-arg; otherwise reads it from git (.git is present in the
 * Docker build context). Falls back to "unknown" so the build never fails.
 */
function gitCommit(): string {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    GIT_COMMIT: gitCommit(),
  },
};

export default nextConfig;
