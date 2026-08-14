# chromium-web-embed

`chromium-web-embed` is a TypeScript library and a Manifest V3 Chrome extension for letting **approved web applications** open and manage tabs in the user's real Chrome browser. It replaces the previous remote-Chromium architecture: no Playwright process, no screenshot stream, no browser server, and no session token are required.

> This package does not render another website *inside* your web application. Modern browser isolation prevents that. Instead, it opens or manages a real local Chrome tab and returns tab metadata and lifecycle events to the approved web app.

## What it can do

| Capability | Available |
| --- | --- |
| Open a real Chrome tab | Yes |
| Navigate, focus, reload, go back or forward | Yes |
| List browser tabs and read tab metadata | Yes, with the `tabs` permission |
| Pin, mute, and close managed tabs | Yes |
| Receive tab update, activation, and removal events | Yes |
| Render another origin in an iframe-like surface | No |
| Read page DOM, keystrokes, passwords, or cookies | No |
| Run arbitrary JavaScript in a page | No |
| Screenshot or stream tab pixels | No |

The deliberately limited surface keeps the extension compatible with Chrome's permission model and prevents a web app from becoming an unrestricted remote-control tool.

## Install

Install directly from the public GitHub repository until a registry release is published:

```bash
npm install github:MOHOAI/chromium-web-embed
```

Build the extension bundle from a clone of this repository:

```bash
npm install
npm run build
```

The build writes a load-unpacked extension to `extension/`.

## Configure the extension

Before installing, edit `extension/manifest.json` and replace the demonstration origins in both `content_scripts.matches` and `externally_connectable.matches` with the exact web-app origins you trust.

```json
{
  "content_scripts": [{
    "matches": ["https://app.example.com/*"],
    "js": ["bridge.js"]
  }],
  "externally_connectable": {
    "matches": ["https://app.example.com/*"]
  }
}
```

Then open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the `extension/` directory. Reload your web application after installation.

> Do not use `https://*/*` as an approved origin. Every origin in this list can ask the extension to manage the user's Chrome tabs.

## Use in a web application

```ts
import { createRealBrowserClient } from "chromium-web-embed";

const browser = createRealBrowserClient();

try {
  const extension = await browser.connect();
  console.log("Extension", extension.version, "is ready");

  const { tab } = await browser.open("https://example.com", {
    active: true,
    pinned: false,
  });

  await browser.reload(tab.id);
  await browser.pin(tab.id);

  const unsubscribe = browser.onTabEvent((event) => {
    console.log("Browser event", event);
  });

  // Call later when the component unmounts.
  unsubscribe();
  browser.dispose();
} catch (error) {
  // The extension is missing, disabled, or this web-app origin is not approved.
  console.error(error);
}
```

## API

| Export | Purpose |
| --- | --- |
| `RealBrowserClient` | Browser-side client for the local extension bridge. |
| `createRealBrowserClient()` | Creates a client with a 1.5-second default response timeout. |
| `BrowserTab` | Safe tab metadata returned to the web app. |
| `BrowserEvent` | `updated`, `activated`, or `removed` lifecycle event. |
| `normalizeTabUrl()` | Accepts only HTTP and HTTPS URLs. |
| `createRealBrowserExtensionManifest()` | Creates a restrictive Manifest V3 configuration for a known set of origins. |

The client offers `connect`, `status`, `open`, `list`, `active`, `navigate`, `activate`, `reload`, `back`, `forward`, `close`, `pin`, `mute`, `onTabEvent`, and `dispose`.

## Security model

The site-side library sends versioned, JSON-only commands through a content-script bridge that checks `window.location.origin`. The extension accepts a fixed allowlist of commands and checks tab identifiers and URL schemes before calling `chrome.tabs`. It does not include a command for evaluating JavaScript, reading the page DOM, injecting code, or accessing credentials.

The `tabs` permission is used only to return tab titles and URLs to approved applications. The extension does not request broad host permissions. If you add permissions such as `scripting`, `activeTab`, or host access in a fork, treat that fork as a new security review.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
```

The test suite covers URL validation, protocol validation, tab-control commands, manifest construction, and client message exchange.

## Migration from 0.x

Version 1.0.0 is a deliberate breaking change. It removes the remote Playwright server, JPEG viewer, bearer token, and the `/server` export. Replace `ChromiumViewer` with `RealBrowserClient`, install the extension once, and use a real local tab instead of a remote session.

## References

- [Chrome: `chrome.tabs` API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome: Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome: Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome: `externally_connectable`](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)

## License

MIT. See [LICENSE](LICENSE).
