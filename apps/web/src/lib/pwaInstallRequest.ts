export const PWA_INSTALL_REQUEST_EVENT = "family:pwa-install-request";

export function isPwaInstallCommand(text: string) {
  return text.trim() === "安装";
}
