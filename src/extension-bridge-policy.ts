export const SUPPORTED_WEB_APP_ORIGINS = ["http://*/*", "https://*/*"] as const;

export function isSupportedWebAppUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}
