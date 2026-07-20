import type { Metadata, Viewport } from "next";
import { KeyboardViewport } from "@/components/keyboard-viewport";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "我爱饭米粒",
  title: "我爱饭米粒 · Family",
  description: "家庭信息的统一收集、整理和追踪入口",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "饭米粒"
  },
  icons: {
    icon: [
      { url: "/family-logo-v2-192.png", sizes: "192x192", type: "image/png" },
      { url: "/family-logo-v2-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/family-logo-v2-apple-touch.png", sizes: "180x180", type: "image/png" }]
  },
  other: {
    "apple-mobile-web-app-capable": "yes"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#202321"
};

const developmentCacheResetScript = `
(() => {
  if (!("serviceWorker" in navigator)) return;
  const reloadMarker = "family-app-dev-sw-reset-v1";
  Promise.all([
    navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister()))
    ),
    "caches" in window
      ? window.caches.keys().then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("family-app-pwa-")).map((key) => window.caches.delete(key)))
        )
      : Promise.resolve()
  ]).then(() => {
    if (navigator.serviceWorker.controller && sessionStorage.getItem(reloadMarker) !== "done") {
      sessionStorage.setItem(reloadMarker, "done");
      location.reload();
      return;
    }
    sessionStorage.removeItem(reloadMarker);
  }).catch(() => undefined);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      {process.env.NODE_ENV !== "production" ? (
        <head><script dangerouslySetInnerHTML={{ __html: developmentCacheResetScript }} /></head>
      ) : null}
      <body>
        <KeyboardViewport />
        <PwaServiceWorker />
        {children}
      </body>
    </html>
  );
}
