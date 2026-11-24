const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Pin the workspace root to this project.
   *
   * There is an unrelated package-lock.json in the user profile directory
   * above this one, and Next.js walks upward looking for a lockfile to decide
   * what to trace when it builds. Left alone it picks the wrong root, which
   * means the file tracing for a standalone build collects the wrong tree —
   * a warning in development and a broken deploy in production.
   */
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
