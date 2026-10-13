# @qviks/track

Visit tracking for our Next.js sites, stored in [Qviks](https://www.qviks.com) analytics.

- **Pageview + `engaged`**: every pageview is recorded (bots included); `engaged` follows once the page
  was visible 3s+ with real input (scroll, pointer, touch, key) or 30s without input. Qviks labels a
  visit human / unverified / bot from that.
- **Clicks**: clicks on links and buttons (label, href, second on the page; never empty space or typed
  text) are kept in memory and sent as one `clicks` event when the page is hidden or left.
- **Server relay**: the browser only calls its own `/api/track`; the server forwards to Qviks API v1
  with the org key. No key ever reaches the browser.
- **Tracked links `/q/<code>`**: `/q/plagat1` (QR, poster), `/q/ig-bio`, `/q/jana/seminare` (a link sent to
  one person, to a subpage) redirect to the page with `utm_source=q&utm_campaign=<code>`. No registry: a new
  poster or person is just a new code. Qviks shows visits and leads per code.
- **Lead -> visit**: the visitor id is mirrored into the `qviks_vid` cookie and forwarded with server calls
  (`visitorFrom`), so Qviks ties a form submission to the visits before it.
- **Owner opt-out**: one switch at [www.qviks.com/notrack](https://www.qviks.com/notrack) sets a cookie
  on every domain we track (each domain serves `/api/notrack`). A green dot top left shows it.

No secrets live here: keys come from each project's environment.

## Install

```sh
bun add github:meacoolash/qviks-track#v1.1.0
```

Env (server only): `QVIKS_API_URL`, and the org key, e.g. `QVIKS_API_KEY`.

## Wire up (3 files + 1 line)

```tsx
// app/layout.tsx (inside <body>)
import { QviksTracker } from "@qviks/track";
<QviksTracker site="mysite" />

// app/api/track/route.ts
import { createTrackHandler } from "@qviks/track/server";
export const POST = createTrackHandler({ key: process.env.QVIKS_API_KEY });

// app/api/notrack/route.ts
import { createNotrackHandler } from "@qviks/track/server";
export const GET = createNotrackHandler();

// middleware.ts / proxy.ts, first thing
import { linkRedirect, notrackRedirect } from "@qviks/track/server";
const r = notrackRedirect(req) ?? linkRedirect(req);
if (r) return r;
```

Then add the domain to the switch's chain in Qviks (`src/lib/notrack.ts`, `STANDALONE_ORIGINS`).
Sites served by the `sites` app are covered automatically.

Custom events: `trackEvent("mysite", "cta_click", { target: "whatsapp" })`.

## Exports

| Path | |
|---|---|
| `@qviks/track` (client) | `QviksTracker`, `useTrack`, `trackEvent`, `NotrackDot`, `getOrCreateVisitorId`, `hasNotrackCookie`, `HUB_URL` |
| `@qviks/track/server` | `createTrackHandler`, `createNotrackHandler`, `notrackRedirect`, `linkRedirect`, `cookieDomain`, `isPreviewHost`, `visitorFrom` |
| `@qviks/track/cookie` | `NOTRACK_COOKIE`, `HUB_URL`, `hasNotrackCookie`, `VISITOR_COOKIE`, `visitorIdFromCookie` (safe anywhere) |

## Develop

`bun test`, then `bun run build` and commit `dist/` (installed from git, no build on install).
Release: bump `version`, tag `vX.Y.Z`, push the tag, bump the `#vX.Y.Z` in each project.
