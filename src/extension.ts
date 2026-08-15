export type ExtensionManifestOptions = {
  allowedOrigins: readonly string[];
  name?: string;
  version?: string;
  description?: string;
  icons?: Partial<Record<16 | 32 | 48 | 128, string>>;
};

/**
 * Creates the secure Manifest V3 configuration required by the bundled extension.
 * The origins must be exact Chrome match patterns, for example "https://app.example.com/*".
 */
export function createRealBrowserExtensionManifest(options: ExtensionManifestOptions) {
  if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length === 0) {
    throw new TypeError("At least one allowed origin is required.");
  }
  for (const pattern of options.allowedOrigins) {
    if (typeof pattern !== "string" || !/^(https?|file):\/\//.test(pattern)) {
      throw new TypeError("allowedOrigins must contain Chrome match patterns.");
    }
  }
  return {
    manifest_version: 3,
    name: options.name ?? "Real Browser Web Bridge",
    version: options.version ?? "3.0.0",
    description: options.description ?? "Lets approved web apps create and control isolated, user-visible Chrome tab groups.",
    permissions: ["tabs", "tabGroups", "debugger", "scripting", "storage"],
    host_permissions: [...options.allowedOrigins],
    background: { service_worker: "service-worker.js", type: "module" },
    content_scripts: [{
      matches: [...options.allowedOrigins],
      js: ["bridge.js"],
      run_at: "document_start",
      all_frames: true,
    }],
    externally_connectable: { matches: [...options.allowedOrigins] },
    icons: options.icons ?? { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
    action: {
      default_title: options.name ?? "Real Browser Web Bridge",
      default_popup: "popup.html",
      default_icon: options.icons ?? { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
    },
  } as const;
}
