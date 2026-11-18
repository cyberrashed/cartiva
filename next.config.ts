import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The local setup uses 127.0.0.1; without this, a dev server started on localhost
  // blocks its own scripts' live connection there and pages never become interactive.
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
