import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: the app is one prerendered page and needs no server after it loads.
  output: "export",
  // Sub-path hosting, e.g. BASE_PATH=/mogi-on-rails for GitHub Pages; empty serves from the root.
  // Client code reads it as import.meta.env.BASE_URL (lib/base-path.ts); postbuild lifts the export.
  basePath: process.env.BASE_PATH ?? "",
};

export default nextConfig;
