import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse loads the PDF.js worker by filesystem path at runtime. Next's
  // standalone tracer sees pdf.mjs but cannot infer that sibling worker file.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs"
    ]
  },
  devIndicators: false,
  reactStrictMode: true,
  // These packages locate worker scripts and language assets at runtime. Keeping
  // them external prevents Next's server bundler from rewriting those paths.
  serverExternalPackages: [
    "@tesseract.js-data/chi_sim",
    "@tesseract.js-data/eng",
    "pdf-parse",
    "tesseract.js"
  ],
};

export default nextConfig;
