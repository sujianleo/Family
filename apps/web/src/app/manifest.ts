import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "我爱饭米粒",
    short_name: "饭米粒",
    description: "家庭信息的统一收集、整理和追踪入口",
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    background_color: "#202321",
    theme_color: "#2f6f68",
    icons: [
      {
        src: "/family-logo-v2-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/family-logo-v2-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/family-logo-v2-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
